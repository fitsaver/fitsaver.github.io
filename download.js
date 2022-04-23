/*
  Backup Fitbit data for personal use
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

"use strict";

(function(self){

/*
 * Internal utilities
 */

// Full list of scopes: https://dev.fitbit.com/build/reference/web-api/developer-guide/application-design/#Scopes
const _fitsaver_url_keys = {
    // prefixed keys:
    activity : "activities",
    heartrate: "activities", // "activities", not "heart"
    nutrition: "foods",
    profile  : "",
    settings : "",
    sleep    : "sleep",
    // suffixed keys:
    social   : "friends",
    weight   : "body",
    // unused keys:
    //'location',
};
function _fitsaver_scopes(params) {
    return params.scope.split(/(?:\+|%20)/);
}

function _fitsaver_headers(params) {
    return { headers: {
        Authorization: params.token_type + ' ' + params.access_token
    } }
}

function _fitsaver_download_uri(version) {
    return 'https://api.fitbit.com/'+version+'/user/-/';
}

function _fitsaver_fail(r) {
    return Promise.reject(
        { error: ( r.status == 429 ) ? 'rate-limit' : 'unknown', message: r.statusText }
    );
}

function _fitsaver_download_single(params,data,key,version) {
    return fetch(
        _fitsaver_download_uri(version)+key+'.json',
        _fitsaver_headers(params),
    )
        .then( r => r.ok ? r.text() : _fitsaver_fail(r) )
        .then( t => data.push( '"'+key+'":'+t ) )
}

function _fitsaver_download_paginated(params,data,key,version,date_range) {
    const out = {},
          handle_uri = uri => (
              fetch( uri, _fitsaver_headers(params) )
                  .then( r => r.ok ? r.json() : _fitsaver_fail(r) )
                  .then( j => {
                      let more_pages_required = false;
                      if ( version >= 1.2 && j.meta && j.meta.state ) {
                          return Promise.reject({ error: j.meta.state });
                      }
                      Object.keys(j)
                          .filter( key => key != 'pagination' )
                          .forEach( key => {
                              out[key] = (out[key]||[]).concat(
                                  j[key].filter( v => v.startTime.split('T')[0] <= date_range[1] )
                              );
                              more_pages_required |= j[key][j[key].length-1].startTime.split('T')[0] <= date_range[1];
                          });
                      if ( more_pages_required && j.pagination.next ) {
                          return handle_uri(j.pagination.next);
                      } else {
                          data.push( '"'+key+'":'+JSON.stringify(out) );
                      }
                  })
          );
    return handle_uri(_fitsaver_download_uri(version)+key+'.json?offset=0&limit=100&sort=asc&afterDate='+date_range[0])
}

function _fitsaver_download_date_range(params,data,key,version,date_range,suffix) {
    const ret = fetch(
        _fitsaver_download_uri(version)+key+'/date/'+date_range.join('/')+(suffix||'')+'.json',
        _fitsaver_headers(params),
    );
    if ( version >= 1.2 ) {
        return ret
            .then( r => r.ok ? r.json() : _fitsaver_fail(r) )
            .then( j => {
                if ( j.meta && j.meta.state ) {
                    return Promise.reject({ error: j.meta.state })
                } else {
                    data.push( '"'+key+(suffix||'')+'":'+JSON.stringify(j) );
                }
            })
        ;

    } else {
        return ret
            .then( r => r.ok ? r.text() : _fitsaver_fail(r) )
            .then( t => data.push( '"'+key+(suffix||'')+'":'+t ) )
        ;
    }
}

function _fitsaver_download_date(params,data,key,version,date) {
    return fetch(
        _fitsaver_download_uri(version)+key+'/date/'+date+'.json',
        _fitsaver_headers(params),
    )
        .then( r => r.ok ? r.text() : _fitsaver_fail(r) )
        .then( t => data.push( '"'+key+'":'+t ) )
}

function _fitsaver_return_prefix(subformat) {
    return '{"format":"https://fitsaver.github.io/formats#'+subformat+'","api":"https://api.fitbit.com/1","created":"'+(new Date().toISOString())+'",';
}

function _fitsaver_return( requests, subformat, callback ) {
    return Promise
        .allSettled(requests)
        .then( results =>
            results.find( r => r.status != "fulfilled" ) ||
            Promise.resolve(
                '{' +
                    '"format":"https://fitsaver.github.io/formats#'+subformat+'",' +
                    '"api":"https://api.fitbit.com/1",' +
                    '"created":"'+(new Date().toISOString())+'",' +
                    callback() +
                '}'
            )
        );
}

/*
 * Public functions
 */

self.fitsaver_auth_uri = function( redirect_uri, client_id, conf ) {
    return (
        'https://www.fitbit.com/oauth2/authorize?response_type=token&redirect_uri='
            + encodeURIComponent(redirect_uri)
            + '&scope=' + Object.keys(_fitsaver_url_keys).join('+')
            + '&expires_in=' + ( conf ? 60*60*24*365 : 60 )
            + '&client_id=' + encodeURIComponent(client_id)
    );
}

/*
 * Download data with no associated date
 *
 * Note that API subscriptions are not downloaded.
 * We don't create API subscriptions, so there's no point getting them.
 *
 * For more information, see:
 *
 *   https://dev.fitbit.com/build/reference/web-api/subscription/get-subscription-list/
 */
self.fitsaver_download_untimed = function(params) {
    let data = [],
        requests = []
    ;
    _fitsaver_scopes(params).map( scope => {
        switch ( scope ) {
        case 'activity':
            requests = requests.concat([
                ''             , // https://dev.fitbit.com/build/reference/web-api/activity/get-lifetime-stats/
                '/favorite'    , // https://dev.fitbit.com/build/reference/web-api/activity/get-favorite-activities/
                '/frequent'    , // https://dev.fitbit.com/build/reference/web-api/activity/get-frequent-activities/
                '/goals/daily' , // https://dev.fitbit.com/build/reference/web-api/activity/get-activity-goals/
                '/goals/weekly', // https://dev.fitbit.com/build/reference/web-api/activity/get-activity-goals/
                '/recent'      , // https://dev.fitbit.com/build/reference/web-api/activity/get-recent-activity-types/
            ].map( id => _fitsaver_download_single(params,data,_fitsaver_url_keys[scope]+id,1) ));
            break;
        case 'weight':
            requests = requests.concat([
                '/log/fat/goal'   , // https://dev.fitbit.com/build/reference/web-api/body-timeseries/get-bodyfat-timeseries-by-date-range/
                '/log/weight/goal', // https://dev.fitbit.com/build/reference/web-api/body-timeseries/get-weight-timeseries-by-date-range/
            ].map( id => _fitsaver_download_single(params,data,_fitsaver_url_keys[scope]+id,1) ));
            break;
        case 'nutrition':
            requests = requests.concat([
                '/log/favorite',   // https://dev.fitbit.com/build/reference/web-api/activity/get-favorite-activities/
                '/log/frequent',   // https://dev.fitbit.com/build/reference/web-api/activity/get-frequent-activities/
                '/log/goal',       // https://dev.fitbit.com/build/reference/web-api/nutrition/get-food-goals/
                '/log/recent',     // https://dev.fitbit.com/build/reference/web-api/activity/get-recent-activity-types/
                '/log/water/goal', // https://dev.fitbit.com/build/reference/web-api/nutrition/get-water-goal/
            ].map( id => _fitsaver_download_single(params,data,_fitsaver_url_keys[scope]+id,1) ));
            requests.push(
                fetch(
                    // https://dev.fitbit.com/build/reference/web-api/nutrition/get-meals/
                    _fitsaver_download_uri(1)+'meals.json',
                    _fitsaver_headers(params),
                )
                    .then( r => r.ok ? r.json() : _fitsaver_fail(r) )
                    .then( j => {
                        data.push( '"meals":'+JSON.stringify(j) );
                        return Promise.allSettled(
                            j.meals.map(
                                meal => fetch(
                                    // https://dev.fitbit.com/build/reference/web-api/nutrition/get-meal/
                                    _fitsaver_download_uri(1)+'/meals/'+meal.id+'.json',
                                    _fitsaver_headers(params),
                                )
                                    .then( r => r.ok ? r.text() : _fitsaver_fail(r) )
                                    .then( t => data.push( '"meals/'+meal.id+'":'+t ) )
                            )
                        );
                    })
            );
            break;
        case 'profile':
            requests = requests.concat([
                'badges',  // https://dev.fitbit.com/build/reference/web-api/user/get-badges/
                'profile', // https://dev.fitbit.com/build/reference/web-api/user/get-profile/
            ].map( id => _fitsaver_download_single(params,data,_fitsaver_url_keys[scope]+id,1) ));
            break;
        case 'settings':
            requests.push(
                fetch(
                    _fitsaver_download_uri(1)+'devices.json', // https://dev.fitbit.com/build/reference/web-api/devices/get-devices/
                    _fitsaver_headers(params),
                )
                    .then( r => r.ok ? r.json() : _fitsaver_fail(r) )
                    .then( j => {
                        data.push( '"devices":'+JSON.stringify(j) );
                        return Promise.allSettled(
                            j
                                .filter( d => d.type == "TRACKER" )
                                .map(
                                    device => fetch(
                                        // https://dev.fitbit.com/build/reference/web-api/devices/get-alarms/
                                        _fitsaver_download_uri(1)+'/devices/tracker/'+device.id+'/alarms.json',
                                        _fitsaver_headers(params),
                                    )
                                        .then( r => r.ok ? r.text() : _fitsaver_fail(r) )
                                        .then( t => data.push( '"tracker/'+device.id+'/alarms":'+t ) )

                                )
                        );
                    })
            );
            break;
        case 'social':
            requests = requests.concat([
                '',             // https://dev.fitbit.com/build/reference/web-api/friends/get-friends/
                'leaderboard/', // https://dev.fitbit.com/build/reference/web-api/friends/get-friends-leaderboard/
            ].map( id => _fitsaver_download_single(params,data,id+_fitsaver_url_keys[scope],1.1) ));
            break;
        case 'sleep':
            requests = requests.concat([
                '/goal', // https://dev.fitbit.com/build/reference/web-api/sleep/get-sleep-goals/
            ].map( id => _fitsaver_download_single(params,data,_fitsaver_url_keys[scope]+id,1.2) ));
            break;
        }
    });
    return _fitsaver_return( requests, "untimed", () => '"results":{'+data.join()+'}' );
}

/*
 * Download data with a date range
 */
self.fitsaver_download_date_range = function(params,date_range) {
    let data = [],
        requests = []
    ;
    _fitsaver_scopes(params).map( scope => {
        switch ( scope ) {
        case 'activity':
            requests = requests.concat([
                // https://dev.fitbit.com/build/reference/web-api/activity/get-activity-log-list/#message-body
                '/list'
            ].map( id => _fitsaver_download_paginated(params,data,_fitsaver_url_keys[scope]+id,1,date_range) ));
            requests = requests.concat([
                // https://dev.fitbit.com/build/reference/web-api/activity-timeseries/get-activity-timeseries-by-date-range/
                '/activityCalories',
                '/calories',
                '/caloriesBMR',
                '/distance',
                '/elevation',
                '/floors',
                '/minutesSedentary',
                '/minutesLightlyActive',
                '/minutesFairlyActive',
                '/minutesVeryActive',
                '/steps',
            ].map( id => _fitsaver_download_date_range(params,data,_fitsaver_url_keys[scope]+id,1,date_range) ));
            break;
        case 'weight':
            requests = requests.concat([
                // https://dev.fitbit.com/build/reference/web-api/body-timeseries/get-body-timeseries-by-date-range/
                '/bmi',
                '/fat',
                '/weight',
            ].map( id => _fitsaver_download_date_range(params,data,_fitsaver_url_keys[scope]+id,1,date_range) ));
            requests = requests.concat([
                // https://dev.fitbit.com/build/reference/web-api/body-timeseries/get-weight-timeseries-by-date-range/
                '/log/fat',
                '/log/weight',
            ].map( id => _fitsaver_download_date_range(params,data,_fitsaver_url_keys[scope]+id,1,date_range) ));
            break;
        case 'heartrate':
            requests = requests.concat([
                // https://dev.fitbit.com/build/reference/web-api/heartrate-timeseries/get-heartrate-timeseries-by-date-range/
                '/heart',
            ].map( id => _fitsaver_download_date_range(params,data,_fitsaver_url_keys[scope]+id,1,date_range) ));
            break;
        case 'nutrition':
            requests = requests.concat([
                // https://dev.fitbit.com/build/reference/web-api/nutrition-timeseries/get-nutrition-timeseries-by-date-range/
                '/log/caloriesIn',
                '/log/water',
            ].map( id => _fitsaver_download_date_range(params,data,_fitsaver_url_keys[scope]+id,1,date_range) ));
            break;
        case 'profile':
            requests = requests.concat([
                'profile', // https://dev.fitbit.com/build/reference/web-api/user/get-profile/
            ].map( id => _fitsaver_download_single(params,data,_fitsaver_url_keys[scope]+id,1) ));
            break;
        case 'sleep':
            requests = requests.concat([
                // https://dev.fitbit.com/build/reference/web-api/sleep/get-sleep-log-by-date-range/
                ''
            ].map( id => _fitsaver_download_date_range(params,data,_fitsaver_url_keys[scope]+id,1.2,date_range) ));
            requests = requests.concat([
                // https://dev.fitbit.com/build/reference/web-api/sleep/get-sleep-log-list/
                '/list'
            ].map( id => _fitsaver_download_paginated(params,data,_fitsaver_url_keys[scope]+id,1.2,date_range) ));
            break;
        }
    });
    return _fitsaver_return( requests, "date_range", () => '"date_range":'+JSON.stringify(date_range)+',"results":{'+data.join()+'}' );
}

/*
 * Download data within a single date
 */
self.fitsaver_download_intraday = function(params,date) {
    let data = [],
        requests = [],
        date_range = [date,date]
    ;
    _fitsaver_scopes(params).map( scope => {
        switch ( scope ) {
        case 'activity':
            requests = requests.concat([
                '',
            ].map( id => _fitsaver_download_date(params,data,_fitsaver_url_keys[scope]+id,1,date) ));
            requests = requests.concat([
                // https://dev.fitbit.com/build/reference/web-api/intraday/get-activity-intraday-by-date-range/
                '/calories',
                '/distance',
                '/elevation',
                '/floors',
                '/steps',
            ].map( id => _fitsaver_download_date_range(params,data,_fitsaver_url_keys[scope]+id,1,date_range,'/1min') ));
            break;
        case 'heartrate':
            // the documentation claims you can pass "1sec", but this doesn't seem to work in practice:
            requests = requests.concat([
                // https://dev.fitbit.com/build/reference/web-api/intraday/get-heartrate-intraday-by-date-range/
                '/heart'
            ].map( id => _fitsaver_download_date_range(params,data,_fitsaver_url_keys[scope]+id,1,date_range,'/1min') ));
            break;
        case 'nutrition':
            requests = requests.concat([
                '/log',       // https://dev.fitbit.com/build/reference/web-api/nutrition/get-food-log/
                '/log/water', // https://dev.fitbit.com/build/reference/web-api/nutrition/get-water-goal/
            ].map( id => _fitsaver_download_date(params,data,_fitsaver_url_keys[scope]+id,1,date) ));
            break;
        case 'profile':
            requests = requests.concat([
                'profile', // https://dev.fitbit.com/build/reference/web-api/user/get-profile/
            ].map( id => _fitsaver_download_single(params,data,_fitsaver_url_keys[scope]+id,1) ));
            break;
        }
    });
    return _fitsaver_return( requests, "date", () => '"date":"'+date+'","results":{'+data.join()+'}' );
}

})(this);
