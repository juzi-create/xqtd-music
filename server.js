// =====================================================
// QQ音乐中转服务（server.js）
// 作用：浏览器直接请求 QQ音乐的接口会被"跨域"拦掉，
//       所以让 Node 代替浏览器去请求（带上 Referer 等头），
//       再把结果转发给页面，并加上允许跨域的头。
// 启动方法：在命令行执行  node server.js
// =====================================================
var http = require('http');
var https = require('https');

var PORT = 3300;
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 从 QQ音乐接口拿文本（GET）
function qqGet(url) {
    return new Promise(function (resolve, reject) {
        https.get(url, {
            headers: {
                'Referer': 'https://y.qq.com/',
                'User-Agent': UA
            }
        }, function (res) {
            var chunks = [];
            res.on('data', function (c) { chunks.push(c); });
            res.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
        }).on('error', reject);
    });
}

// 向 QQ音乐接口发数据（POST）
function qqPost(url, body) {
    return new Promise(function (resolve, reject) {
        var data = JSON.stringify(body);
        var req = https.request(url, {
            method: 'POST',
            headers: {
                'Referer': 'https://y.qq.com/',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'User-Agent': UA
            }
        }, function (res) {
            var chunks = [];
            res.on('data', function (c) { chunks.push(c); });
            res.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// 有些接口返回 JSONP（callback(...) 包着 JSON），统一剥掉外壳再解析
function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\)\s*;?\s*$/, ''));
    }
}

var server = http.createServer(function (req, res) {
    // 允许任何网页来访问这个服务
    res.setHeader('Access-Control-Allow-Origin', '*');

    var u = new URL(req.url, 'http://localhost');

    // ----- 接口1：搜索歌曲  GET /search?key=关键词 -----
    if (u.pathname === '/search') {
        var key = u.searchParams.get('key') || '';
        var p = u.searchParams.get('p') || '1';    // 页码
        var n = u.searchParams.get('n') || '20';   // 每页数量
        var searchUrl = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp' +
            '?w=' + encodeURIComponent(key) + '&format=json&p=' + p + '&n=' + n;
        qqGet(searchUrl).then(function (text) {
            var json = safeJson(text);
            var list = (json.data && json.data.song && json.data.song.list) || [];
            var songs = list.map(function (s) {
                return {
                    mid: s.songmid,          // 歌曲在 QQ音乐里的唯一编号
                    name: s.songname,
                    singer: (s.singer || []).map(function (x) { return x.name; }).join(' / '),
                    interval: s.interval,     // 时长（秒）
                    album: s.albumname,       // 所属专辑名
                    albummid: s.albummid,     // 所属专辑编号
                    lyric: s.lyric || ''      // 官方注释，如「《崩坏：星穹铁道》2.2版本PV」
                };
            });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(songs));
        }).catch(function (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
        });
        return;
    }

    // ----- 接口2：获取播放地址  GET /songurl?mid=歌曲编号 -----
    if (u.pathname === '/songurl') {
        var mid = u.searchParams.get('mid') || '';
        var body = {
            req_0: {
                module: 'vkey.GetVkeyServer',
                method: 'CgiGetVkey',
                param: {
                    guid: '10000',
                    songmid: [mid],
                    songtype: [0],
                    uin: '0',
                    loginflag: 1,
                    platform: '20'
                }
            }
        };
        qqPost('https://u.y.qq.com/cgi-bin/musicu.fcg', body).then(function (text) {
            var json = safeJson(text);
            var info = json.req_0 && json.req_0.data && json.req_0.data.midurlinfo && json.req_0.data.midurlinfo[0];
            var purl = info && info.purl;
            // purl 为空 = 这首歌需要会员，拿不到免费播放地址
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ url: purl ? 'https://ws.stream.qqmusic.qq.com/' + purl : '' }));
        }).catch(function (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
        });
        return;
    }

    // ----- 接口3：专辑歌曲列表  GET /album?albummid=专辑编号 -----
    if (u.pathname === '/album') {
        var albummid = u.searchParams.get('albummid') || '';
        var body = {
            comm: { ct: 24, cv: 10000 },
            albumSongList: {
                module: 'music.musichallAlbum.AlbumSongList',
                method: 'GetAlbumSongList',
                param: { albumMid: albummid, begin: 0, num: 60, order: 2 }
            }
        };
        qqPost('https://u.y.qq.com/cgi-bin/musicu.fcg', body).then(function (text) {
            var json = safeJson(text);
            var d = json.albumSongList && json.albumSongList.data;
            var list = (d && d.songList) || [];
            var songs = list.map(function (item) {
                var s = item.songInfo || {};
                return {
                    mid: s.mid,
                    name: s.name,
                    singer: (s.singer || []).map(function (x) { return x.name; }).join(' / '),
                    interval: s.interval
                };
            });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(songs));
        }).catch(function (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
        });
        return;
    }

    res.statusCode = 404;
    res.end('not found');
});

server.listen(PORT, function () {
    console.log('QQ音乐中转服务已启动：http://localhost:' + PORT);
});
