var restclient = require('node-rest-client');
var Twit = require('twit');
var date = require('datejs');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('users.db');
var moment = require('moment');
var fs = require('fs');

// init twitter

var T;

function initTwitter() {
  T = new Twit({
    consumer_key:         twit_data.consumer_key,
    consumer_secret:      twit_data.consumer_secret,
    access_token:         twit_data.access_token,
    access_token_secret:  twit_data.access_token_secret
  });
}

// load twitter configuration file

var file = __dirname + "/";

if(process.argv[2]) {
  file += process.argv[2];
} else {
  file += "twit_config.json";
}

console.log(logdt() + " loading configuration from " + file);

// twiter api configuration
var twit_data;

// random phrases the bot will tweet
var phrases;

// bot screen name
var bot_screen_name;

// Test mode - if true does not tweet
var test_mode;

// timeouts
var random_tweet_timeout = 99999;
var favorite_timeout     = 99999;
var reply_tweet_timeout  = 99999;

fs.readFile(file, 'utf8', function (err, data) {

  console.log(logdt() + " initializing configuration");

  if (err) {
    console.log(logdt() + 'Error: ' + err);
    process.exit();
    return;
  }
 
  var file_data        = JSON.parse(data);
  twit_data            = file_data.twit_data;

  if(!twit_data) {
    console.log(logdt() + " [ERROR] could not load twitter configuration!");
    process.exit();
  }

  phrases              = file_data.phrases;

  if(!phrases) {
    console.log(logdt() + " [ERROR] could not load phrases");
    process.exit();
  }

  search_phrase        = file_data.search_phrase;

  if(!search_phrase) {
    console.log(logdt() + " [ERROR] could not load search phrase");
    process.exit();
  }

  bot_screen_name      = file_data.bot_screen_name;

  if(!bot_screen_name) {
    console.log(logdt() + " [ERROR] could not load bot screen name");
    process.exit();
  }

  test_mode            = file_data.test_mode;

  random_tweet_timeout = file_data.random_tweet_timeout;

  if(!random_tweet_timeout) {
    console.log(logdt() + " [ERROR] could not load random tweet");
    process.exit();
  }

  favorite_timeout     = file_data.favorite_timeout;

  if(!favorite_timeout) {
    console.log(logdt() + " [ERROR] could not load favorite_timeout");
    process.exit();
  }

  reply_tweet_timeout  = file_data.reply_tweet_timeout;

  if(!reply_tweet_timeout) {
    console.log(logdt() + " [ERROR] could not load reply tweet timeout");
    process.exit();
  }
 
  console.log(logdt() + " configuration loaded");

  initTwitter();

  initEvents();
});

// db code

db.serialize(function() {
  try {
    db.run("CREATE TABLE if not exists tweets (tweet_id TEXT PRIMARY KEY, screen_name TEXT, tweet_text TEXT)");
  } catch (e) {
    console.log(logdt() + e);
  }
});

var tweet_data;

var statement =   "";

function logdt() {
  var moment_date = moment();
  var dt = moment_date.format("MM-DD-YYYY h:mm:ss a");
  return "[" + dt + "]";
}

function tweetReply (id, screen_name) {
  statement = "@"+screen_name+" " + randomPhrase();
  var moment_date = moment();
  if(!test_mode) {
    console.log(logdt() + ": " + statement);
    T.post('statuses/update', { status: statement, in_reply_to_status_id: id }, function(err, data, response) {
      // do nothing
    })
  } else {
    console.log(logdt() + " [TEST] " + statement);
  }
}

function postRandomTweet() {
  statement = randomPhrase();
  if(!test_mode) {
    console.log(logdt() + ": " + statement);
    T.post('statuses/update', { status: statement }, function(err, data, response) {
    });
  } else {
    console.log(logdt() + " [TEST] " + statement);
  }
}

function favRTs () {
  if(!test_mode) {
    T.get('statuses/retweets_of_me', {}, function (e,r) {
      for(var i=0;i<r.length;i++) {
        T.post('favorites/create/'+r[i].id_str,{},function(){});
      }
      console.log(logdt() + 'harvested some RTs'); 
    });
  } else {
    console.log(logdt() + " [TEST] harvested some RTs");
  }
}

function randomPhrase() {
  return phrases[Math.floor((Math.random() * phrases.length))];
}

function getTweetData() {
  var today = new Date();
  var dd = today.getDate();
  var mm = today.getMonth()+1;//January is 0!`

  var yyyy = today.getFullYear();
  if(dd<10){dd='0'+dd}
  if(mm<10){mm='0'+mm}
  var today = yyyy+'-'+mm+'-'+dd;

  try {
    T.get('search/tweets', { q: search_phrase + ' since:' + today, count: 100}, function(err, data, response) {
      tweet_data = data.statuses;
      console.log(logdt() + "Found " + data.statuses.length + " tweets for processing.");
    });
  } catch (e) {
    console.log(logdt() + e);
  }  
}

function popTweet() {
  if(tweet_data && tweet_data.length > 0) {
    var tweet = tweet_data.shift();
    return tweet;
  } else {
    return -1;
  }
}

function processTweet() {
  var today = new Date();
  var dd = today.getDate();
  var mm = today.getMonth()+1;//January is 0!`

  var yyyy = today.getFullYear();
  if(dd<10){dd='0'+dd}
  if(mm<10){mm='0'+mm}
  var today = yyyy+'-'+mm+'-'+dd;

  var tweet = popTweet();

  if(tweet == -1) {
    console.log(logdt() + "No tweet data found! Getting new tweet data.");
    getTweetData();
  } else if (tweet.user.screen_name == bot_screen_name) {
    processTweet();
  } else {

    try {

      db.serialize( function() {
      
        // data
        var screen_name = tweet.user.screen_name;
        var tweet_id = tweet.id_str;

        var tweet_text = tweet.text;

        selectTweet(tweet_id, screen_name, tweet_text, function(rows) { 
          insertTweet(tweet_id, screen_name, tweet_text, function() {
            tweetReply(tweet_id, screen_name);
          });
        });
      
      });
    } catch (e) {
      console.log(logdt() + e);
    }
  }
}


// *** DB HELPER METHODS ***


function insertTweet(tweet_id, screen_name, tweet_text, callback) {
  db.serialize(function() {
    var stmt = db.prepare('INSERT INTO tweets VALUES(?, ?, ?)');
    stmt.run(tweet_id, screen_name, tweet_text);
    stmt.finalize();
    callback();
  });
}

function selectTweet(tweet_id, screen_name, tweet_text, callback) {
  var query = "select * from tweets where tweet_id="+tweet_id;
  db.all(query, function(err, rows) {
    if(rows.length == 0) {
      callback(rows);
    } else {
      processTweet();
    }
  });
}


// *** EVENTS ***

function initEvents() {

  // post a random tweet
  setInterval(function() {
    try {
      postRandomTweet();
    }
   catch (e) {
      console.log(logdt() + e);
    }
  },1000 * 60 * random_tweet_timeout); // every 25 minutes

  // favorite retweets
  setInterval(function() {
    try {
      favRTs();
    }
   catch (e) {
      console.log(logdt() + e);
    }
  },1000 * 60 * favorite_timeout); // every hour

  // tweet @ random public tweet containing the keyword
  setInterval(function() {
    try {
      processTweet();
    } catch (e) {
      console.log(logdt() + e);
    }
  }, 1000 * 60 * random_tweet_timeout); // every three hours

}
