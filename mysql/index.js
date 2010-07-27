var reader = require('./serializers').reader;
var writer = require('./serializers').writer;
var cmd = require('./commands');
var net = require('net');
var sys = require('sys');
var queue = require('./containers').queue;

function packetLength(data) {
  return data.charCodeAt(0)+
         (data.charCodeAt(1) << 8)+
         (data.charCodeAt(2) << 16);
}

function dump(d) {
  for (var i=0; i < d.length; ++i) {
    sys.puts(i.toString()+" "+d.charAt(i)+" "+d.charCodeAt(i).toString());
  }
}

function extend(destination, source) {
  Object.keys(source).forEach(function(k){ destination[k] = source[k]; });
}

// ----------------------------------------------------------------------------

function SocketClient(connection) {
  var client = this;
  this.commands = new queue();
  this.connection = connection;
  this.connection.pscache = {};
  this.connection.setEncoding("binary");
  this.connection.setTimeout(0);
  this.connection.buffer = ""; // todo: use 8-bit node Buffer
  this.connection.addListener("data", function(data) {
    // TODO: move to 'onconnect' event
    // replace connected with 'first packet' or 'ready state' or smth similar
    if (!this.connected) {
      this.connected = true;
      client.dispatch_packet();
    }
    this.buffer += data;
    var len = packetLength(this.buffer);
    while (this.buffer.length >= len + 4) {
      var packet = this.buffer.substr(4,len);
      client.dispatch_packet(new reader(packet));
      this.buffer = this.buffer.substr(len+4, this.buffer.length-len-4);
      len = packetLength(this.buffer);
    }
  });
}

extend(SocketClient.prototype, {
  close: function() {
    return this.add(cmd.close());
  },

  debug: function(text) {
    return this.add(cmd.debug(text));
  },

  auth: function(dbname, user, password) {
    return this.add(cmd.auth(dbname, user, password));
  },

  query: function(q) {
    return this.add(cmd.query(q));
  },

  prepare: function(q) {
    return this.add(cmd.prepare(q));
  },

  // TODO: too many copy-paste, cleanup
  execute: function(q, parameters) {
    if (!this.pscache)
      this.pscache = {};
    if (this.autoPrepare == true) {
      var cached = this.connection.pscache[q];
      if (!cached) {
        var prepare_cmd = this.add(cmd.prepare(q));
        var execute_cmd = this.add(cmd.execute(q, parameters));
        prepare_cmd.addListener('prepared', function(ps) { execute_cmd.ps = ps; });
        prepare_cmd.addListener('error', function(err) {
          execute_cmd.emit('error', err);
          execute_cmd.prepare_failed = true; 
        });
      } else {
        var execute_cmd = this.add(cmd.execute(q, parameters));
        execute_cmd.ps = cached;
      }
      return execute_cmd;
    }      
    return this.add(cmd.execute(q, parameters));
  },

  terminate: function() {
    this.connection.end();
  },

  write_packet: function(packet, pnum) {
    packet.addHeader(pnum);
    this.connection.write(packet.data, 'binary');
  },

  dispatch_packet: function(packet) {
    if (this.commands.empty())
      return;
    if (this.commands.top().process_packet(packet))
    {
      this.commands.shift();
      this.connection.emit('queue', this.commands.length);
      this.dispatch_packet();
    }
  },

  // proxy request to socket eventemitter
  addListener: function() {
    this.connection.addListener.apply(this.connection, arguments);
  },

  add: function(c) {
    c.client = this;
    if (this.debug) c.debug = true;
    var need_start_queue = this.connection.connected && this.commands.empty();
    this.commands.push(c);
    this.connection.emit('queue', this.commands.length); 
    if (need_start_queue)
      this.dispatch_packet();
    //var connection = this.connection;
    //c.addListener('end', function(cmd) { connection.emit('command_end', c); });
    //c.addListener('error', function(e) { sys.puts(e.message); });
    return c;
  }
});

exports.createTCPClient = function(host, port) {
  var connection = net.createConnection(port || 3306, host || "locahost");
  return new SocketClient(connection);
}

// ----------------------------------------------------------------------------
// Simple (high level) interface

const tinerr = new Error('Transaction not properly initialized');

function execOrQuery(cmdname, conn, query, args, callback) {
  if (typeof args === 'function') {
    callback = args;
    args = null;
  }
  var c = conn[cmdname](query, args);
  var self = this;
  if (callback) {
    var results = {rows:[]};
    c.addListener('row', function(row, meta) {
      results.rows.push(row);
    }).addListener('error', function(err) {
      this.error = err;
    }).addListener('end', function(c2) {
      if (this.error) {
        callback.call(self, this.error);
      } else {
        callback.call(self, null, results);
      }
    });
  }
  return c;
}

function Transaction(database) {
  this.database = database;
  this.error = tinerr; // cleared by Database.transaction
}

Transaction.prototype.exec = function(query, args, callback) {
  var self = this;
  if (self.error) {
    if (callback) {
      callback(new Error('transaction is in a dirty state because of '+
                         self.error));
    }
    return;
  }
  var execCmd = execOrQuery.call(this,
    'execute', this.database.client, query, args, callback);
  execCmd.addListener('error', function(err) {
    self.error = err; 
  });
  self.lastExecCmd = execCmd;
  return execCmd;
}

function Database () {
}

Database.prototype.open = function(options, callback) {
  var opt = {
    host: 'locahost',
    port: 3306,
    database: undefined,
    user: undefined,
    password: undefined,
  };
  if (typeof options === 'object') {
    Object.keys(options).forEach(function(k){ opt[k] = options[k] });
  } else {
    opt.database = String(options);
  }
  //if (!opt.database)
  //  throw new TypeError('"database" option not set');
  this.client = exports.createTCPClient(opt.host, opt.port);
  var authCommand = this.client.auth(opt.database, opt.user, opt.password);
  authCommand.setCallback(callback);
  this.client.query('SET autocommit=0;');
  this.client.autoPrepare = true;
  this.client.rowAsHash = true;
  return authCommand;
}

Object.defineProperty(Database.prototype, 'debug', {
  get: function(){ return this.client.debug; },
  set: function(v){ this.client.debug = v; }
});

Database.prototype.transaction = function(oncreate, onerror) {
  var t = new Transaction(this);
  t.error = null;
  this.client.query('BEGIN');
  oncreate(t);
  var commit = this.client.query("");
  t.lastExecCmd.addListener('end', function() {
    commit.sql = t.error ? 'ROLLBACK' : 'COMMIT';
    if (t.error && onerror) {
      commit.addListener('end', function(){ onerror(t.error); });
    }
  });
  return this;
}

// returns a execute command object
Database.prototype.exec = function(query, args, callback) {
  return execOrQuery.call(this, 'execute', this.client, query, args, callback);
}

// returns a query command object
Database.prototype.query = function(rawsql, callback) {
  return execOrQuery.call(this, 'query', this.client, rawsql, callback);
}

// returns a close command object
Database.prototype.close = function(callback) {
  return this.client.close().setCallback(callback);
};

exports.openDatabase = function(options, callback) {
  var db = new Database();
  return db.open(options, callback ? function(err){callback(err, db)} : null);
}

exports.Database = Database;
exports.Transaction = Transaction;
