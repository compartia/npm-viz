"use strict";
exports.__esModule = true;
var request = require("request");
request('http://registry.npmjs.com/json/0.0.13', function (error, response, body) {
    console.log('error:', error); // Print the error if one occurred
    console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
    console.log('body:', body); // Print the HTML for the Google homepage.
});
