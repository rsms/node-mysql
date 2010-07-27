#!/usr/local/bin/node

var sys = require("sys");
var client = require("mysql/client");
var pool = require("mysql/pool").pool;

function dump_rows(cmd)
{
   cmd.addListener('row', function(r) { sys.puts("row: " + sys.inspect(r)); } );
}

function createConnection()
{
   var db = client.createTCPClient(); 
   db.autoPrepare = true;
   db.auth("test", "testuser", "testpass");
   return db;
}

var dbpool = new pool(createConnection, 3);

function test_pool(p)
{
    for (var i=0; i < 6; ++i)
    {
        p.get( 
            function(conn)
            {
                dump_rows(conn.execute("select sleep(2),?", [0+i]));
            }
        );
    }
}

test_pool(dbpool);
setTimeout(function() { test_pool(dbpool); }, 1000);
setTimeout(function() { test_pool(dbpool); }, 2000);
setTimeout(function() { test_pool(dbpool); }, 3000);
setTimeout(function() { test_pool(dbpool); }, 4000);
