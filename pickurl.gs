var global = this;
var g_spreadsheet_name = "pickurl";
var g_base_url = "http://liveralmask.herokuapp.com/api/url";
ogas.cache.properties( PropertiesService.getScriptProperties() );

function debug(){
  global.run({
    "user_name" : "PICKURL-TEST",
    "text"      : 'http://www.google.co.jp',
    "token"     : "",
  });
}

function doPost( e ){
  global.run({
    "user_name" : e.parameter.user_name,
    "text"      : e.parameter.text,
    "token"     : e.parameter.token,
  });
}

function setup(){
  try{
    if ( null === ogas.cache.get( "spreadsheet_id" ) ){
      ogas.cache.set( "spreadsheet_id", ogas.spreadsheet.create( g_spreadsheet_name ).getId() );
    }
    
    global.run({
      "user_name" : "",
      "text"      : "",
      "token"     : "",
    });
  }catch ( err ){
    ogas.log.err( ogas.string.format( "{0}\n{1}", err, err.stack ) );
  }
}

function input_spreadsheet_id(){
  ogas.application.input_spreadsheet_id();
}

(function( action ){
  action.on_url = function( params ){
    var title = "";
    var url = params.match.matches[ 0 ];
    var parsed_url = global.url_parse( url );
    switch ( parsed_url.host ){
    case "www.toranoana.jp":{
      var response = global.url_order( url, [[ "click", '//input[@value="はい"]' ]], [[ "title", "xpath", '//td[@class="DetailData_L"]' ]] );
      title = response.results.title[ 0 ].inner_html;
    }break;
    
    case "www.melonbooks.co.jp":{
      url = ogas.string.format( "{0}&adult_view=1", url );
      var response = global.url_order( url, [], [[ "title", "xpath", '//table[@class="stripe"]/tbody/tr/td' ]] );
      title = response.results.title[ 0 ].inner_html;
    }break;
    
    default:{
      var response = global.url_order( url, [], [[ "og_title", "xpath", '//meta[@property="og:title"]' ], [ "title", "xpath", '//title' ]] );
      if ( 0 < response.results.og_title.length ){
        title = response.results.og_title[ 0 ].attributes.content;
      }else{
        title = response.results.title[ 0 ].inner_html;
      }
    }break;
    }
    
    if ( "" === title ) title = ogas.string.format( "Not found title: {0}", url );
    global.slack_post( title );
    
    params.is_update = false;
    return params;
  };
  
  action.on_rule = function( params ){
    var rules_sheet = ogas.vars.get( "rules_sheet" );
    var rules = ogas.sheet.values_to_records( ogas.sheet.range( rules_sheet ).getValues() );
    var text = ogas.application.rules_to_array( rules, ogas.string.format( "[Rules] {0}", rules.length ) ).join( "\n" );
    global.slack_post( ogas.string.format( "@{0} {1}", params.request.user_name, text ) );
    params.is_update = false;
    return params;
  };
  
  action.update = function( request ){
//ogas.log.dbg( ogas.json.encode( request ) );
    var response = {};
    var params = {
      "request" : {
        "time"      : request.time,
        "user_name" : request.user_name
      },
      "is_update" : true,
    };
    var matches = ogas.pattern.matches( "action", request.text );
    ogas.array.each( matches, function( match, i ){
      params.match = match;
      var result = ogas.method.call( action, ogas.string.format( "on_{0}", match.value.name ), params );
      if ( ogas.is_def( result ) ) params = result;
      if ( ! params.is_update ) return false;
    });
    return response;
  };
})(global.action = global.action || {});

global.run = function( request ){
  request.time = ogas.time.local_time();
  ogas.application.run( global.Application, request );
};

global.slack_post = function( text ){
  var slack_incoming_webhook_url = ogas.vars.get( "slack_incoming_webhook_url" );
  if ( "" === slack_incoming_webhook_url ){
    ogas.log.err( "Not found slack_incoming_webhook_url" );
    return;
  }
  ogas.slack.post( slack_incoming_webhook_url, { "text" : text, "link_names" : 1 } );
};

global.http_post = function( url, payload ){
  if ( ogas.is_undef( payload ) ) payload = {};
  
  var params = {
    "method"  : "post",
    "payload" : payload
  };
  return ogas.http.request( url, params ).getContentText();
};

global.url_parse = function( url ){
  var params = {
    "url" : url
  };
  return ogas.json.decode( global.http_post( ogas.string.format( "{0}/parse", g_base_url ), params ) );
};

global.url_order = function( url, request_orders, response_orders ){
  if ( ogas.is_undef( request_orders ) )  request_orders = [];
  if ( ogas.is_undef( response_orders ) ) response_orders = [];
  
  var params = {
    "url"             : url,
    "request_orders"  : ogas.json.encode( request_orders ),
    "response_orders" : ogas.json.encode( response_orders )
  };
  return ogas.json.decode( global.http_post( ogas.string.format( "{0}/order", g_base_url ), params ) );
};

global.Application = function(){
  ogas.Application.call( this );
};
ogas.object.inherits( global.Application, ogas.Application );
global.Application.prototype.start = function(){
  var spreadsheet_id = ogas.cache.get( "spreadsheet_id" );
  if ( null === spreadsheet_id ){
    ogas.log.err( "Not found spreadsheet_id" );
    return;
  }
  
  var spreadsheet = ogas.spreadsheet.open( spreadsheet_id );
  if ( null === spreadsheet ){
    ogas.log.err( "Spreadsheet open error id={0}", spreadsheet_id );
    return;
  }
  ogas.vars.set( "spreadsheet", spreadsheet );
  
  ogas.log.sheet( ogas.sheet.open( spreadsheet, "log" ) );
  
  ogas.application.sheet( this, spreadsheet, "config" );
  ogas.application.sheet( this, spreadsheet, "rules" );
  
  this.m_is_update = true;
};
global.Application.prototype.update = function(){
  do{
    if ( 0 <= ogas.vars.get( "ignore_users" ).indexOf( this.m_request.user_name ) ) break;
    
    var slack_outgoing_webhook_token = ogas.vars.get( "slack_outgoing_webhook_token" );
    if ( "" !== slack_outgoing_webhook_token ){
      if ( slack_outgoing_webhook_token !== this.m_request.token ) break;
    }
    
    this.response( global.action.update( this.m_request ) );
  }while ( false );
};
global.Application.prototype.end = function(){
  
};
global.Application.prototype.on_sheet_config = function( sheet ){
  if ( "" === ogas.sheet.range( sheet, "A1" ).getValue() ){
    ogas.sheet.add_row( sheet, [ "slack_incoming_webhook_url" ] );
    ogas.sheet.add_row( sheet, [ "slack_outgoing_webhook_token" ] );
    ogas.sheet.add_row( sheet, [ "ignore_users", "slackbot", "channel" ] );
  }
  
  var values = ogas.sheet.col_to_row_values( ogas.sheet.range( sheet ).getValues() );
  var records = ogas.sheet.values_to_records( values );
  var ignore_users = [];
  ogas.array.each( records, function( record, i ){
    if ( "" !== record.ignore_users ) ignore_users.push( record.ignore_users );
  });
  
  ogas.vars.set( "slack_incoming_webhook_url", records[ 0 ].slack_incoming_webhook_url );
  ogas.vars.set( "slack_outgoing_webhook_token", records[ 0 ].slack_outgoing_webhook_token );
  ogas.vars.set( "ignore_users", ignore_users );
};
global.Application.prototype.on_sheet_rules = function( sheet ){
  if ( "" === ogas.sheet.range( sheet, "A1" ).getValue() ){
    ogas.sheet.add_row( sheet, [ "name", "pattern", "flags" ] );
    ogas.sheet.add_row( sheet, [ "url",  "(http|https):\/\/([a-zA-Z0-9\.\/?_=&-]+)" ] );
    ogas.sheet.add_row( sheet, [ "rule", "ルール" ] );
  }
  
  ogas.application.add_patterns( "action", sheet );
};
