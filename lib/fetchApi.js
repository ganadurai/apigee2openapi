var inquirer = require('inquirer');
var pathLib = require('path');
var unzip = require('node-unzip-2');
var fs = require('fs');
var apiBundle = require('./downloadApi.js');
var proxy = require('./proxy2openapi.js');
var proxySpec3 = require('./proxy2openapi-3x.js');
var mkdirp = require('mkdirp');
var glob = require('glob');
var async = require('async');

module.exports = {
  fetchProxy: fetchProxy
};

var platformQuestion = [
  { name: 'platform', message: 'Platform?', choices: ['Apigee Edge', 'Apigee X', 'Apigee Hybrid'], type: 'list'},
]

var questions = [
  { name: 'baseuri',      message: 'Base URI?', default: 'https://api.enterprise.apigee.com' },
  { name: 'organization', message: 'Organization?'},
  { name: 'environment', message: 'Environment?'},
  { name: 'username',     message: 'User Id?'},
  { name: 'password',     message: 'Password?', type: 'password'},
  { name: 'api', message: 'API Proxy Name ?'},
  { name: 'revision',     message: 'Revision Number ?', default: 1},
  { name: 'proxyEndPoint',message: 'API Proxy End Point ?', 
                          default: 'https://{ORGANIZATION}-{ENV}.apigee.net'},
  { name: 'specRevision', message: 'OpenAPI spec revision?', default: '3.0.0'}
];

var ngQuestions = [
  { name: 'organization', message: 'Organization?'},
  { name: 'token',     message: 'GCP Auth Token?'},
  { name: 'api', message: 'API Proxy Name ?'},
  { name: 'revision',     message: 'Revision Number ?'},
  { name: 'proxyEndPoint',     message: 'API Proxy End Point ?'},
  { name: 'specRevision', message: 'OpenAPI spec revision?', default: '3.0.0'}
];

function fetchProxy(options, cb) {
  if (options.file && options.api && options.proxyEndPoint) {
    // process local proxy bundle to generate openapi spec
    options.localProxy = true;
    fetchProxyLocal(options, cb)
  } else {
    // download bundle from Edge and then generate openapi spec
    fetchProxyPrompt(options, cb)
  }
}

function fetchProxyLocal(options, cb) {
  if (!options.destination) {
    options.destination = pathLib.join(__dirname, '../api_bundles') + "/" + options.api;
  }
  //Cleanup the destination folder before unzipping
  fs.rmSync(options.destination, { recursive: true, force: true }, err => {
    if (err) {
      console.log('Error in cleaning the directory - ' + options.destination);
      throw err
    }
  });
  generateOpenapi(options, cb)
}

function fetchProxyPrompt(options, cb) {
  inquirer.prompt(platformQuestion).then((platformAnswer) => {
    if ((platformAnswer.platform === undefined) || 
        ((platformAnswer.platform != 'Apigee Edge') && 
         (platformAnswer.platform != 'Apigee X') &&
         (platformAnswer.platform != 'Apigee Hybrid'))) {
      throw new Error("Please select one of the valid values for the platform");
    } else {
      if (platformAnswer.platform == 'Apigee Edge') {
        console.log('Selected platform is Edge');
        inquirer.prompt(questions).then((answers) => {
          answers.platform = platformAnswer.platform;
          if (answers.proxyEndPoint == 'https://{ORGANIZATION}-{ENV}.apigee.net') {
            answers.proxyEndPoint 
              = 'https://' + answers.organization + '-' + answers.environment + '.apigee.net'
          }
          processFetchProxyPrompt(options, answers, cb);
        });
      } else {
        inquirer.prompt(ngQuestions).then((answers) => {
          answers.platform = platformAnswer.platform;
          answers.baseuri = "https://apigee.googleapis.com";
          processFetchProxyPrompt(options, answers, cb);
        });
      }
    }
  });
}

function processFetchProxyPrompt(options, answers, cb) {
  var destination = options.destination || pathLib.join(__dirname, '../api_bundles');
  destination = destination + "/" + answers.api;
  answers.file = destination + "/" + answers.api + ".zip";
  for (answer in answers) {
    if (!answers[answer]) {
      throw new Error("Missing input : " + answer);
      return cb("Missing input : " + answer, {});
    }
  }

  //Cleanup the destination folder before unzipping
  fs.rmSync(destination, { recursive: true, force: true }, err => {
    if (err) {
      console.log('Error in cleaning the directory - ' + options.destination);
      throw err
    }
  });

  // create destination folder..
  mkdirp(destination, function (err) {
    if (err) {
      return cb(err, {});
    }
    // Get Bundle from Apigee...
    apiBundle.downloadProxy(answers, function(err) {
      if (err) {
        return cb(err, {});
      }
      delete answers['password']
      options.destination = destination
      options.file = answers.file
      options.api = answers.api
      options.proxyEndPoint = answers.proxyEndPoint;
      options.platform = answers.platform;
      options.baseuri = answers.baseuri;
      options.token = answers.token;
      options.version = answers.specRevision;
      
      generateOpenapi(options, cb)
    });
  });
}

function generateOpenapi(options, cb) {
  if (JSON.stringify(options.version)) {
  } else {
    options.version="3.0.0";
  }

  // Unzip folder.....
  var stream = fs.createReadStream(options.file).pipe(unzip.Extract({ path: options.destination }));
  var had_error = false;
  stream.on('error', function(err){
    had_error = true;
    return cb(err, {});
  });
  stream.on('close', function(){
    if (!had_error) {
      if (options.password) 
        delete options['password'];

      // generate openapi...
      // Generate multiple openapi files based on number of files in proxies.
      // Read through proxy files..
      glob(options.destination + "/apiproxy/proxies" + "/*.xml", options, function (er, files) {
        async.each(Object.keys(files), function (i, callback) {
          if (JSON.stringify(options.version).indexOf("3") > -1) {
            proxySpec3.genopenapi(options.destination, options, files[i], function (err, reply) {
              if (err) {
                callback(err, {});
              }
              callback(null, {});
            });
          } else {
            proxy.genopenapi(options.destination, options, files[i], function (err, reply) {
              if (err) {
                callback(err, {});
              }
              callback(null, {});
            });
          }
        }, function (err) {
          // if any of the file processing produced an error, err would equal that error
          if (err) {
            cb(err, {})
        }
          else {
            cb(null, {});
          }
        });
      });
    }
  });
}
