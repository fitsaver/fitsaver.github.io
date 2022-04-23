#!/usr/bin/env node

/*
  Example for downloading Fitbit data in node.js
  Copyright (C) 2022 Andrew Sayers

  This program is free software; you can redistribute it and/or
  modify it under the terms of the GNU General Public License
  as published by the Free Software Foundation; version 2
  of the License.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program; if not, write to the Free Software
  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
*/

/*

  To download Fitbit data, you need:

  * authorisation data for the Fitbit API
    * can be created by going to https://fitsaver.github.io/?conf
  * the ability to generate URLs for the web API
    * see download.js
  * a script that can GET those URLs
    * this file shows how to do that

  Note that this file requires `node-fetch`, which you will need to install yourself.

 */

"use strict";

const fs = require('fs');
const dl = require('./download.js');

// make node-fetch available to download.js:
globalThis.fetch = require('node-fetch');

// Check command-line arguments:
if ( process.argv.length < 3 || process.argv.length > 5 || !fs.existsSync(process.argv[2]) ) {
    console.log(`Usage: ${process.argv[1]} <config-filename> [start-date] [end-date]`);
    process.exit(2);
}

// Load configuration:
const config = JSON.parse(fs.readFileSync(process.argv[2]));

// Start the relevant download:
let filename, promise;
switch ( process.argv.length ) {
case 3: // untimed
    filename = 'fitsaver_data.json';
    promise = dl.fitsaver_download_untimed(config.params);
    break;
case 4: // intraday
    filename = 'fitsaver_'+process.argv[3]+'.json';
    promise = dl.fitsaver_download_intraday(config.params,process.argv[3]);
    break;
case 5: // date_range
    filename = 'fitsaver_'+process.argv.slice(3).join('_to_')+'.json';
    promise = dl.fitsaver_download_date_range(config.params,process.argv[3],process.argv[4]);
    break;
}

// Wait for the download to complete:
promise
    .then( contents => {
        if ( contents.status && contents.status == "rejected" ) {
            console.error(contents);
            process.exit(2);
        } else {
            fs.writeFileSync( filename, contents );
        }
    });
