var sys = require('sys');
var constants = require('./constants');

function writer()
{
   this.data = "";
}

writer.prototype.zstring = function(s)
{
   this.data += s + "\u0000";
   return this;
}

//
//  length-coded number
//
//  Value Of     # Of Bytes  Description
//  First Byte   Following
//  ----------   ----------- -----------
//  0-250        0           = value of first byte
//  251          0           column value = NULL
//                           only appropriate in a Row Data Packet
//  252          2           = value of following 16-bit word
//  253          3           = value of following 24-bit word
//  254          8           = value of following 64-bit word
//
writer.prototype.lcnum = function(n)
{
   if (n < 251)
       this.data += String.fromCharCode(n);
   else if (n < 0xffff)
   {
       this.data += String.fromCharCode(252);
       this.data += String.fromCharCode( n & 0xff );
       this.data += String.fromCharCode( (n >> 8) & 0xff );
   } else if (n < 0xffffff)
   {
       this.data += String.fromCharCode(253);
       this.data += String.fromCharCode( n & 0xff );
       this.data += String.fromCharCode( (n >> 8) & 0xff );
       this.data += String.fromCharCode( (n >> 16) & 0xff );
   } 
   /*
      TODO: 64 bit number
   */
   return this;
}

//
// write length-coded string to the buffer
//
writer.prototype.lcstring = function(s)
{
   this.lcnum(s.length);
   this.data += s;
   return this;
}

writer.prototype.add = function(s)
{
   if (typeof s == "string")      // add string bufer
       this.data += s; 
   else if (typeof s == "number") // add four byte integer
   {
       this.data += String.fromCharCode( s & 0xff );
       this.data += String.fromCharCode( (s >> 8)  & 0xff );
       this.data += String.fromCharCode( (s >> 16) & 0xff );
       this.data += String.fromCharCode( (s >> 24) & 0xff );
   }
   return this;
}

writer.prototype.int2 = function(s)
{
    this.data += String.fromCharCode( s & 0xff );
    this.data += String.fromCharCode( (s >> 8)  & 0xff );
}

writer.prototype.addHeader = function(n)
{
    var length = this.data.length;
    var header = "";
    header += String.fromCharCode( length     & 0xff );
    header += String.fromCharCode( length>>8  & 0xff );
    header += String.fromCharCode( length>>16 & 0xff );
    var packet_num = n ? n : 0;
    header += String.fromCharCode( packet_num );
    this.data = header + this.data;
    return this;
}

function reader(data)
{
   this.data = data;
   this.pos = 0;
}

// deserialise mysql binary field
reader.prototype.unpackBinary = function(type, unsigned)
{
    // debug dump
    //return "_not_implemented_ " + constants.type_names[type] + " " + sys.inspect(this.data);

    var result;
    switch (type)
    {
    case constants.types.MYSQL_TYPE_STRING:
    case constants.types.MYSQL_TYPE_VAR_STRING:
    case constants.types.MYSQL_TYPE_BLOB:
        result = this.lcstring();
        break;
    case constants.types.MYSQL_TYPE_LONG:
        result = this.num(4);
        break;
    case constants.types.MYSQL_TYPE_LONGLONG:
        result = this.num(8);
        break;
    case constants.types.MYSQL_TYPE_NEWDECIMAL:
        result = parseFloat(this.lcstring());
        break;
    default:
        result = "_not_implemented_ " + constants.type_names[type] + " " + sys.inspect(this.data); //todo: throw exception here
    }
    return result;
}

// read n-bytes number 
reader.prototype.num = function(numbytes)
{
    var res = 0;
    var factor = 1;
    for (var i=0; i < numbytes; ++i)
    {
        res += this.data.charCodeAt(this.pos) * factor;
        factor = factor << 8;
        this.pos++;
    }
    return res;
}

reader.prototype.field = function()
{
  var field = {
    catalog: this.lcstring(),
    db: this.lcstring(),
    table: this.lcstring(),
    org_table: this.lcstring(),
    name: this.lcstring(),
    org_name: this.lcstring(),
    charsetnum: 0,
    length: 0,
    type: 0,
    flags: 0,
    decimals: 0,
    defval: 0,
  };
  this.skip(1);
  field.charsetnum = this.integer(2);
  field.length = this.integer(4);
  field.type = this.integer(1);
  field.flags = this.integer(2);
  field.decimals = this.integer(1);
  this.skip(2);
  field.defval = this.lcstring();
  return field;
}

function binary(n)
{
    var res = "";
    var nbits = 0;
    while(n != 0)
    {
        var bit = n - Math.floor(n/2)*2;
        res = bit + res;
        n = Math.floor(n/2);
        nbits++;
    }
    for(; nbits <= 8; ++nbits)
         res = "0" + res;    
    return res;
}

reader.prototype.zstring = function() {
  var res = "";
  var c;
  while(c = this.data.charCodeAt(this.pos++)) {
    res += String.fromCharCode(c);
  }
  return res;
}

reader.prototype.lcstring = function() {
  var len = this.lcnum();
  var res = this.bytes(len);
  return res;
}

reader.prototype.isEOFpacket = function() {
  return this.data.charCodeAt(0) == 254 && this.data.length < 9
}

reader.prototype.eof = function() {
  return this.pos >= this.data.length;
}

reader.prototype.tail = function() {
  var res = this.data.substr(this.pos, this.data.length - this.pos);
  this.pos = this.data.length;
  return res;
}

reader.prototype.isErrorPacket = function() {
  return this.data.charCodeAt(0) === 0xff;
}

reader.prototype.readOKpacket = function() {
  var res = {};
  res.field_count = this.data.charCodeAt(this.pos++);
  if (res.field_count === 0xff) {
    // error
    res.errno = this.data.charCodeAt(this.pos) + (this.data.charCodeAt(this.pos+1)<<8);
    this.pos += 8;
    //this.pos++; // skip sqlstate marker, "#"
    //res.sqlstate = this.bytes(5);
  } else {
    res.affected_rows = this.lcnum();
    res.insert_id = this.lcnum();
    res.server_status = this.num(2);
    res.warning_count = this.num(2);
  }
  res.message = this.tail();
  return res;
}

reader.prototype.lcnum = function() {
  var b1 = this.data.charCodeAt(this.pos);
  this.pos++;
  return b1;
}

reader.prototype.readPacketHeader = function() {
  var res = { length: 0, packetNum:0 };
  res.length += this.data.charCodeAt(0);
  res.length += this.data.charCodeAt(1) << 8;
  res.length += this.data.charCodeAt(2) << 16;
  res.packetNum = this.data.charCodeAt(3);
  this.pos += 4;
  return res;
}

reader.prototype.skip = function(nbytes) {
  this.pos += nbytes;
}

reader.prototype.integer = function(n) {
  var d = 0;
  var end = this.pos+n;
  for (var i=0;i<n;i++) {
    if (this.pos === end)
      return NaN; // too few bytes
    var v = this.data.charCodeAt(this.pos++);
    if (i) v = v << (8 * i);
    d += v;
  }
  return d;
}

reader.prototype.bytes = function(n)
{
   var res = "";
   var end = this.pos+n;
   while(this.pos < end) {
     res += this.data.charAt(this.pos);
     this.pos++;
   }
   return res;
}

exports.reader = reader;
exports.writer = writer;
