var mysql = require ('mysql');
var pool  = mysql.createPool ({
    host     : 'localhost',
    user     : 'root',
    password : 'success'
});
var phantom = require ('phantom'), ph_;
var WAIT_PH_EXIT_TIMEOUT = 2000;    // milliseconds
var PHANTOM_PAGE_CNT = 100; // the threshold of page cnt that phantom process exit

var toHTML = {
    on: function(str) {
        var a = [],
        i = 0;
        for (; i < str.length;) a[i] = str.charCodeAt(i++);
        return "&#" + a.join(";&#") + ";"
    },
    un: function(str) {
        return str.replace(/&#(x)?([^&]{1,5});?/g,
        function(a, b, c) {
            return String.fromCharCode(parseInt(c, b ? 16 : 10))
        })
    }
};
//alert(toHTML.on("侯文斌"));
//alert(toHTML.un("&#20399;&#25991;&#25996;"));

var toUN = {
    on: function(str) {
        var a = [],
        i = 0;
        for (; i < str.length;) a[i] = ("00" + str.charCodeAt(i++).toString(16)).slice( - 4);
        return "\\u" + a.join("\\u")
    },
    un: function(str) {
        return unescape(str.replace(/\\/g, "%"))
    }
};
//alert(toUN.on("侯文斌"));
//alert(toUN.un("\u4faf\u6587\u658c"));
//alert(toUN.un("\\u4faf\\u6587\\u658c"));

// insert artist into database
var insertArtists = function (conn, artists, idx) {
    if (idx == artists.length) {
        console.log ('totally inserted artists ' + artists.length);
        conn.release ();
        return;
    }
    var sql = 'INSERT INTO music.artist SET name = ?, link_baidu = ?, created_at = NOW()';
    var artist = artists[idx];
    var params = [artist[1], 'http://music.baidu.com' + artist[2]];
    console.log ('begin insert artist ' + artist[1]);
    conn.query (sql, params, function (err, info) {
        if (err) {
            console.log (err);
        } else {
            console.log ('insert artist ' + artist[1] + ' succeed');
        }
        insertArtists (conn, artists, idx + 1);
    });
};

var insertSongs = function (conn, artists, idx, start, ting_uid, songs, sidx) {
    if (songs.length == sidx) {
        console.log ('totally inserted songs ' + sidx);
        conn.release ();
        nextPage (artists, idx, start, ting_uid);
        return;
    }
    var song = songs[sidx];
    var sql = 'INSERT INTO music.song SET artist_id = ?, name = ?, page_link_baidu = ?, created_at = NOW()';
    var params = [artists[idx].id, song[1], song[0]];
    console.log ('begin insert song ' + song[1] + ' ' + song[0]);
    conn.query (sql, params, function (err, info) {
        if (err) {
            console.log (err);
        } else {
            console.log ('insert song ' + song[0] + ' succeed');
        }
        insertSongs (conn, artists, idx, start, ting_uid, songs, sidx + 1);
    });
};

var insertSongResource = function (conn, songs, idx, downloads) {
    var song = songs[idx];
    var sql = 'INSERT INTO music.song_resource SET song_id = ?, download_page = ?,'
        + ' url_standard = ?, url_high = ?, url_super = ?, created_at = NOW()';
    var params = [song.id, song.page_link_baidu + '/download', downloads[0], downloads[1], downloads[2]];
    console.log ('begin to insert song download url of ' + song.name);
    console.log (downloads);
    conn.query (sql, params, function (err, info) {
        if (err) {
            console.log (err);
        } else {
            console.log ('insert song ' + song.name + ' download url succeed');
        }
        conn.release ();
        if (idx % PHANTOM_PAGE_CNT == 0) {
            ph_.exit ();
            ph_ = null;
            setTimeout (function () {
                discoverSongDownloadUrl (songs, idx + 1);
            }, WAIT_PH_EXIT_TIMEOUT);
        } else {
            discoverSongDownloadUrl (songs, idx + 1);
        }
    });
};

// discover artists
var discoverArtists = function () {
    phantom.create ("--load-images=false", "--web-security=no", "--ignore-ssl-errors=yes", {port: 12345}, function (ph) {
        console.log ("Phantom Bridge Initiated")
        ph_ = ph;
        ph_.createPage (function (page) {
            page.set ('onConsoleMessage', function (msg) {
                console.log ('get console msg: ' + msg);
            });

            console.log("Page created!")
            var url = 'http://music.baidu.com/artist';
        page.open (url, function (status) {
            console.log ('open ' + url + ', status ' + status);
            if (status != "success") {
                console.log("failed to open " + url);
                process.exit (1);
            }
            page.evaluate (function () {
                var first = true;
                var artists = [];
                $('li[class="list-item"]').each (function () {
                    if (first) {
                        first = false;
                        return;
                    }
                    $(this).find ('ul[class="clearfix"]').find ('a').each (function (i) {
                        var arr = [i, $(this).attr ('title'), $(this).attr ('href')];
                        artists.push (arr);
                    });
                });
                return artists;
            }, function (artists) {
                page.close ();
                pool.getConnection (function (err, conn) {
                    insertArtists (conn, artists, 0);
                });
            });
        });
        });
    });
};

// next page of song list
var nextPage = function (artists, idx, start, ting_uid) {
    if (null == ph_) {
        phantom.create ("--load-images=false", "--web-security=no", "--ignore-ssl-errors=yes", {port: 12346}, function (ph) {
            console.log ("Phantom Bridge Initiated")
            ph_ = ph;
            doNextPage (artists, idx, start, ting_uid);
        });
    } else {
        doNextPage (artists, idx, start, ting_uid);
    }
};

var doNextPage = function (artists, idx, start, ting_uid) {
    ph_.createPage (function (page) {
        page.set ('onConsoleMessage', function (msg) {
            console.log ('get console msg: ' + msg);
        });
        console.log("Page created!")
        var url = 'http://music.baidu.com/data/user/getsongs?start=' + start + '&ting_uid=' + ting_uid;
        page.open (url, function (status) {
            console.log ('open ' + url + ', status ' + status);
            if (status != "success") {
                console.log("failed to open " + url);
                process.exit (1);
            }
            page.injectJs ("jquery-2.0.3.min.js");
            page.evaluate (function () {
                return document.body.innerHTML;
            }, function (body) {
                var str = toUN.un (body.replace (/\\\//g, '\/'));
                var songs = [];
                while (1) {
                    var i = str.indexOf ('href="\/song\/');
                    if (-1 == i)
                        break;
                    var j = str.indexOf ('>', i);
                    if (-1 == j)
                        break;
                    var s = str.substring (i, j);
                    console.log (s);
                    var href = s.substring (6, s.indexOf ('"', 6)).match (/\/song\/\d+/g)[0];
                    console.log (href);
                    var k = s.indexOf ('"', s.indexOf ('title'));
                    var title = s.substring (k + 1, s.indexOf ('"', k + 1));
                    console.log (title);
                    songs.push (['http://music.baidu.com' + href, title]);

                    str = str.substr (j);
                }
                if (songs.length) {
                    page.close ();
                    pool.getConnection (function (err, conn) {
                        insertSongs (conn, artists, idx, start + songs.length, ting_uid, songs, 0);
                    });
                } else {
                    console.log ('no next song page');
                    // start to discover songs of next artist
                    ph_.exit ();
                    ph_ = null;
                    setTimeout (function () {
                        discoverSongsOfArtist (artists, idx + 1);
                    }, WAIT_PH_EXIT_TIMEOUT);
                }
            });
        });
    });
};

// discover songs of artist
var discoverSongsOfArtist = function (artists, idx) {
    if (artists.length == idx) {
        console.log ('finish discover songs, totally discover artist count ' + idx);
        return;
    }
    var artist = artists[idx];
    console.log (idx + '/' + artists.length + ' start to discover songs of artist ' + artist.name);
    var ting_uid = artist.link_baidu.match(/\d+/);
    console.log ('ting_uid ' + ting_uid);

    nextPage (artists, idx, 0, ting_uid);
};

// entry to discover songs of artists
var discoverSongsOfArtists = function () {
    pool.getConnection (function (err, conn) {
        var sql = 'SELECT id, name, link_baidu FROM music.artist AS a,'
                + '(SELECT MAX(artist_id) max_id FROM music.song) AS b WHERE a.id >= b.max_id';
        console.log (sql);
        conn.query (sql, function (err, results, fields) {
            if (err) {
                console.log (err);
                process.exit (1);
            }
            conn.release ();
            discoverSongsOfArtist (results, 0);
        });
    });
};

// parse download url
var parseDownload = function (songs, idx) {
    ph_.createPage (function (page) {
        page.set ('onConsoleMessage', function (msg) {
            console.log ('get console msg: ' + msg);
        });
        console.log("Page created!")
        var song = songs[idx];
        var url = song.page_link_baidu + '/download';
        page.open (url, function (status) {
            console.log ('open ' + url + ', status ' + status);
            if (status != "success") {
                console.log("failed to open " + url);
                process.exit (1);
            }
            page.injectJs ("jquery-2.0.3.min.js");
            page.evaluate (function () {
                var downloads = ['', '', ''];
                var prefix = 'http://music.baidu.com';
                // TBD need login to get the high quality music download url
                var href = $('#128').attr ('href');
                if (href != undefined)
                    downloads[0] = prefix + href;
                return downloads;
            }, function (downloads) {
                page.close ();
                pool.getConnection (function (err, conn) {
                    insertSongResource (conn, songs, idx, downloads);
                });
            });
        });
    });
};

// discover song download url
var discoverSongDownloadUrl = function (songs, idx) {
    if (songs.length == idx) {
        console.log ('finish discover songs download url, totally discover songs count ' + idx);
        return;
    }
    var song = songs[idx];
    console.log (idx + '/' + songs.length + ' start to discover song ' + song.name);

    if (null == ph_) {
        phantom.create ("--load-images=false", "--web-security=no", "--ignore-ssl-errors=yes", {port: 12347}, function (ph) {
            console.log ("Phantom Bridge Initiated")
            ph_ = ph;
            parseDownload (songs, idx);
        });
    } else {
        parseDownload (songs, idx);
    }
};

// entry to discover songs download url
var discoverSongsDownloadUrl = function () {
    pool.getConnection (function (err, conn) {
        var sql = 'SELECT id, name, page_link_baidu FROM music.song AS a '
                + ' WHERE NOT EXISTS (SELECT 1 FROM music.song_resource AS b WHERE a.id = b.song_id)';
        console.log (sql);
        conn.query (sql, function (err, results, fields) {
            if (err) {
                console.log (err);
                process.exit (1);
            }
            conn.release ();
            discoverSongDownloadUrl (results, 0);
        });
    });
};

// main
//discoverArtists ();
//discoverSongsOfArtists ();
discoverSongsDownloadUrl ();
