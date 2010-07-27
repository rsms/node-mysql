var sys = require('sys'),
    mysql = require('../mysql');

var conf = {
  //host: 'example.com', // Hostname or IP address. Defaults to "localhost".
  database: 'foo',       // Database to "use".
  user: 'foo',           // Authenticate as user...
  password: 'secret',    // ...with password.
}

// Open a new connection
mysql.openDatabase(conf, function(err, db){
  // Handle error (unknown host, auth error, no database, etc):
  if (err) throw err;

  // Print some "under the hood" info to stdout
  //db.debug = true;

  // Standard query interface with implicitly (cached) prepared statements
  db.exec('SELECT * FROM users WHERE username LIKE ?', ['%o%'], function(err, r){
    if (err) throw err;
    sys.puts(sys.inspect(r));
  });

  // Perform a raw SQL query
  db.query('SELECT * FROM users', function(err, r){
    if (err) throw err;
    sys.puts(sys.inspect(r));
  });

  // Execute statements in a transaction. Only effecive with transactional
  // table engines (e.g. InnoDB). For other table engines this is simply a
  // sequence of statements.
  db.transaction(function(t){
    t.exec('INSERT INTO users (username) VALUES (?)', ['john1']);
    // no such table, causing transaction to abort:
    t.exec('INSERT INTO foobartable (username) VALUES (?)', ['john2']);
    t.exec('INSERT INTO users (username) VALUES (?)', ['john3']);
  }, function(err){
    sys.error('transaction error: '+(err.stack || err));
  });

  // Close the connection
  db.close();
});
