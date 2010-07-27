# node-mysql

Asynchronous Mysql client module for Nodejs, written in JavaScript. No other mysql runtime required.

## Simple example

    var conf = {
      database: 'foo',
      user: 'foo',
      password: 'secret',
    }
    mysql.openDatabase(conf, function(err, db){
      db.exec('SELECT * FROM users WHERE name LIKE ?', ['A%'], function(err, r){
        if (err) throw err;
        sys.puts(sys.inspect(r.rows));
      });
      db.close();
    });

Output might be:

    [
      { id: 1, username: 'adam' }
    , { id: 2, username: 'aston' }
    ]

## Highlights

- commands are pipelined
- types are converted mysql<->javascript according to field type
- prepared statements are cached and auto-prepared
- row packet ( query ) and binary row packet ( execute ) handled transparently equal


## API

### Overview

- `openDatabase(options, callback(err, db)) -> Database` -- equivalent to: `new Database().open(options, callback)`.
- `new Database()` -- a new Database object.
  - `.open(options[, callback]) -> Command` -- connect and authenticate.
  - `.transaction(oncreate(tx)[, onerror(err)]) -> this` -- execute statements in a transaction (built up in the `oncreate` handler).
  - `.query(sql[, callback(err, results)]) -> Command` -- raw query.
  - `.exec(sql, [args,] [callback(err, results)]) -> Command` -- execute a statement.
  - `.close([callback]) -> Command` -- close the connection.
- `new Transaction(database)` -- a new (unusable) Transaction object. Use `Database.prototype.transaction` to create a new (usable) transaction object.
  - `.exec(sql, [args,] [callback(err, results)]) -> Command` -- execute a statement.

### Overview of the lower-level API

- `createTCPClient(host, port) -> SocketClient` -- create a new TCP client.
- `new SocketClient(connection)` -- a client which will use `connection` to communicate.
  - `.auth`
  - `.query`
  - `.prepare`
  - `.execute`
  - `.close` - create and enqueue corresponding command
  - `.execute` also adds prepare command if there is no cached statement and the property `autoPrepare` set to true.
  - `SocketClient.prototype.terminate` - close conection immediately


### Commands

All commands fire "end" event at the end of command executing.

#### auth(user, pass, db)

Perform mysql connection handshake. Should be always a first command. User and password can be a false value (e.g. `null`) in which case the empty string (`""`) will be used.

Events:

- `authorized(serverStatus)`

#### query(sql)

Simple query.

Events:

- `field(field)` - one for each field description
- `fields_eof()` - after last field
- `row(rows)` - array of field values, fired for each row in result set

#### client.prepre(sql)

Prepare a statement and store result in client.pscache

Events:

- `prepared(preparedStatement)`
- `parameter(field)` - input parameter description

#### execute(sql, parameters)

Parameters is an array of values. Known types are sent in appropriate mysql binary type.

> TODO: currently this is not true, type is always string and input converted using param.toString().

Events (same as for `query()`):

- `field(field)` - one for each field description
- `fields_eof()` - after last field
- `row(rows)` - array of field values, fired for each row in result set


### mysql/pool

#### pool(createNewConnectionCallback, minConnections)

Create a new pool, spawn minConnections at start using createNewConnectionCallback. One should usually call auth command on a new connection before returning it. 

#### pool.get(connectionAvailableCallback)

Calls connectionAvailableCallback when there is connection with queue `length < pool.maxQueue`.

Properties:

- `minConnections`
- `maxConnections`
- `maxQueue`
- `maxWaiters`

## TODO:

- Use node Buffers (8-bit) instead of text string
- Support for transparent reconnect after server resets connection (the 3600 sec server timeout)

## Related

- Mysql protocol documentation:
  - http://forge.mysql.com/wiki/MySQL_Internals_ClientServer_Protocol

- Other Nodejs MySQL clients:
  - http://github.com/masuidrive/node-mysql
  - http://github.com/Sannis/node-mysql-libmysqlclient
  - http://github.com/Guille/node.dbslayer.js/ 
