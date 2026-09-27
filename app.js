// ===== 崩铁音乐站：功能逻辑 =====
// 歌单数据在 songs.js，页面结构在 index.html，样式在 style.css

var player = document.getElementById('player');
var currentList = [];   // 当前显示在表格里的歌曲
var playingSrc = '';    // 正在播放的歌曲的 mid，空 = 没在播
var nowText = '';       // 当前提示条文字，暂停/恢复时要用
var currentTagLabel = '';   // 当前分类标签列的列名（如「PV角色」「版本」），搜索时为空

// ===== 1.5. JSONP 工具：浏览器直连 QQ音乐接口（不需要中转服务）=====
// 原理：浏览器不让普通请求跨域，但 <script> 标签不受这个限制。
// 往页面里塞一个 <script src="接口地址&callback=函数名">，
// QQ音乐会把数据包成「函数名(数据)」返回，浏览器一执行，函数就拿到数据了。
var jsonpSeq = 0;
function jsonp(url, ok, fail) {
    var name = '__jsonp' + (++jsonpSeq);
    var script = document.createElement('script');
    var timer = setTimeout(function () {
        delete window[name];
        script.remove();
        if (fail) { fail(); }
    }, 10000);
    window[name] = function (data) {
        clearTimeout(timer);
        delete window[name];
        script.remove();
        ok(data);
    };
    script.onerror = function () {
        clearTimeout(timer);
        delete window[name];
        script.remove();
        if (fail) { fail(); }
    };
    script.src = url + '&callback=' + name;
    document.body.appendChild(script);
}

// 拿某首歌的播放地址：ok(地址)；没有免费地址时 fail('vip')
function getSongUrl(mid, ok, fail) {
    var data = {
        req_0: {
            module: 'vkey.GetVkeyServer',
            method: 'CgiGetVkey',
            param: { guid: '10000', songmid: [mid], songtype: [0], uin: '0', loginflag: 1, platform: '20' }
        }
    };
    jsonp('https://u.y.qq.com/cgi-bin/musicu.fcg?data=' + encodeURIComponent(JSON.stringify(data)), function (d) {
        var info = d.req_0 && d.req_0.data && d.req_0.data.midurlinfo && d.req_0.data.midurlinfo[0];
        if (info && info.purl) {
            ok('https://ws.stream.qqmusic.qq.com/' + info.purl);
        } else {
            fail('vip');
        }
    }, fail);
}

// ===== 2. 视图切换 =====
function showHome() {
    document.getElementById('list-view').classList.add('hidden');
    document.getElementById('home-view').classList.remove('hidden');
    document.getElementById('home-view').scrollTop = 0;   // 内部滚动条回到顶部
}

function showCategory(i) {
    var c = categories[i];
    document.getElementById('list-title').textContent = c.icon + ' ' + c.name;
    document.getElementById('list-sub').textContent = (c.desc ? c.desc + ' · ' : '') + '共 ' + c.songs.length + ' 首';
    document.getElementById('home-view').classList.add('hidden');
    document.getElementById('list-view').classList.remove('hidden');
    currentTagLabel = c.tagLabel || '';   // 这个分类有没有标签列
    render(c.songs);
    document.getElementById('list-view').scrollTop = 0;   // 进分类页时列表从最上面开始显示
}

// ===== 3. 首页分类卡片 =====
function renderCategories() {
    var html = '';
    for (var i = 0; i < categories.length; i++) {
        html += `<div class="category-card" onclick="showCategory(${i})">
            <div class="cat-icon">${categories[i].icon}</div>
            <div class="cat-name">${categories[i].name}</div>
            <div class="cat-desc">${categories[i].desc || ''}</div>
            <span class="cat-count">${categories[i].songs.length} 首</span>
        </div>`;
    }
    document.getElementById('category-grid').innerHTML = html;
}

// ===== 4. 渲染歌曲表格 =====
function render(list) {
    currentList = list;
    // 这个歌单有没有标签信息（角色PV=角色名、版本PV=版本号）→ 有就多渲染一列
    // 搜索结果没有标签列（跨分类标签混在一起不好看）
    var hasTag = !!currentTagLabel && list.some(function (s) { return !!s.tag; });
    document.getElementById('list-head').innerHTML =
        '<th>标号</th><th>歌曲名称</th>' +
        (hasTag ? '<th>' + currentTagLabel + '</th>' : '') +
        '<th>在线播放</th><th>时长</th>';
    var html = '';
    for (var i = 0; i < list.length; i++) {
        html += `<tr>
            <td class="num">${i + 1}</td>
            <td class="song-name">${list[i].name}${list[i].singer ? `<span class="singer">${list[i].singer}</span>` : ''}${list[i].lyric ? `<span class="singer">${list[i].lyric}</span>` : ''}</td>
            ${hasTag ? `<td><span class="tag-badge">${list[i].tag || '—'}</span></td>` : ''}
            <td><button type="button" class="play-btn" onclick="playMusic(${i})">播放</button></td>
            <td>${list[i].interval ? `<span class="duration">${formatTime(list[i].interval)}</span>` : ''}</td>
        </tr>`;
    }
    if (list.length === 0) {
        html = '<tr><td colspan="' + (hasTag ? 5 : 4) + '" style="text-align:center;color:#9a9ab5;padding:28px">这个分类还没有歌曲</td></tr>';
    }
    document.getElementById('song-list').innerHTML = html;
    updatePlayingRow();
}

// ===== 5. 播放控制 =====
function playMusic(i) {
    var song = currentList[i];
    if (!song) { return; }

    if (playingSrc === song.mid) {
        if (player.paused) {
            // 之前被暂停了 → 继续播
            player.play();
            setNowPlaying('正在播放：' + song.name);
        } else {
            // 再点一次 → 暂停
            player.pause();
        }
        updatePlayingRow();
    } else {
        // 直连 QQ音乐接口拿播放地址，再播
        getSongUrl(song.mid, function (url) {
            startPlay(url, song);
        }, function (reason) {
            alert(reason === 'vip' ? '这首歌暂时没有免费播放地址（可能需要会员）' : '拿不到播放地址，QQ音乐接口可能改版了');
        });
    }
}

function startPlay(url, song) {
    player.src = url;
    var p = player.play();
    if (p && p.catch) {
        p.catch(function () { alert('无法播放该歌曲'); playingSrc = ''; updatePlayingRow(); });
    }
    playingSrc = song.mid;
    setNowPlaying('正在播放：' + song.name);
    updatePlayingRow();
    // 新歌开始：进度条和时间数字归零（总时长等加载出来才显示）
    progress.value = 0;
    progress.style.setProperty('--val', '0%');
    curTime.textContent = '0:00';
    durTime.textContent = '0:00';
}

// 把所有行的显示状态和 playingSrc 对齐
function updatePlayingRow() {
    document.querySelectorAll('#song-list tr').forEach(function (row) {
        row.classList.remove('playing');
        row.classList.remove('paused');
        var btn = row.querySelector('.play-btn');
        if (btn) btn.textContent = '播放';
    });
    if (!playingSrc) { return; }
    for (var i = 0; i < currentList.length; i++) {
        if (currentList[i].mid === playingSrc) {
            var row = document.querySelectorAll('#song-list tr')[i];
            if (row) {
                row.classList.add('playing');
                // 播放中=灰色「暂停」；被暂停了=粉色「继续」
                row.classList.toggle('paused', player.paused);
                row.querySelector('.play-btn').textContent = player.paused ? '继续' : '暂停';
            }
            break;
        }
    }
}

// ===== 6. 搜索（只在曲库内找：歌名 / 歌手 / 角色标签）=====
function searchLib() {
    var kw = document.getElementById('search').value.trim().toLowerCase();
    if (!kw) { return; }

    // 把全部分类的歌曲摊平，逐首匹配
    var results = [];
    for (var i = 0; i < categories.length; i++) {
        for (var j = 0; j < categories[i].songs.length; j++) {
            var s = categories[i].songs[j];
            if ((s.name || '').toLowerCase().indexOf(kw) >= 0 ||
                (s.singer || '').toLowerCase().indexOf(kw) >= 0 ||
                (s.tag || '').toLowerCase().indexOf(kw) >= 0) {
                results.push(s);
            }
        }
    }

    document.getElementById('list-title').textContent = '🔍 搜索结果：' + kw;
    document.getElementById('list-sub').textContent = '曲库内共找到 ' + results.length + ' 首';
    document.getElementById('home-view').classList.add('hidden');
    document.getElementById('list-view').classList.remove('hidden');
    currentTagLabel = '';   // 搜索结果没有标签列
    render(results);
    document.getElementById('list-view').scrollTop = 0;   // 搜索结果同样从顶部开始显示
}

// ===== 7. 进入网站 =====
function enterSite() {
    document.getElementById('entry-screen').classList.add('hidden');
}

// 提示条右侧按钮：暂停 / 恢复当前正在播的内容
function togglePlay() {
    if (!nowText) { return; }
    if (player.paused) {
        player.play();
        document.getElementById('now-text').textContent = nowText;
        document.getElementById('eq').classList.add('active');
    } else {
        player.pause();
        document.getElementById('now-text').textContent = nowText + '（已暂停）';
        document.getElementById('eq').classList.remove('active');
    }
}

// 底部按钮跟着播放状态走：播放中=灰色⏸，暂停后=灰色▶
// 挂播放器的 play/pause 事件，不管从哪条路暂停（底部按钮/列表行按钮）都自动更新
function setPauseBtn(paused) {
    document.getElementById('pause-btn').textContent = paused ? '▶' : '⏸';
}
player.addEventListener('play', function () { setPauseBtn(false); updatePlayingRow(); });
player.addEventListener('pause', function () { setPauseBtn(true); updatePlayingRow(); });

// ===== 8. 底部提示条 =====
function setNowPlaying(text) {
    nowText = text || '';
    document.getElementById('now-text').textContent = text || '当前没有播放歌曲';
    document.getElementById('eq').classList.toggle('active', !!text);
}

function formatTime(sec) {
    sec = Math.floor(sec);   // 播放中的currentTime带小数，先取整
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
}

// ===== 9. 进度条和音量调节 =====
var progress = document.getElementById('progress');
var volume = document.getElementById('volume');
var curTime = document.getElementById('cur-time');
var durTime = document.getElementById('dur-time');
volume.style.setProperty('--val', volume.value + '%');   // 音量条初始填满

// 播放中 → 进度条跟着走，时间数字跟着跳
player.addEventListener('timeupdate', function () {
    if (!player.duration) { return; }
    var pct = player.currentTime / player.duration * 100;
    progress.value = pct;
    progress.style.setProperty('--val', pct + '%');
    curTime.textContent = formatTime(player.currentTime);
    durTime.textContent = formatTime(player.duration);
});

// 拖动进度条 → 跳到对应位置
progress.addEventListener('input', function () {
    if (player.duration) { player.currentTime = progress.value / 100 * player.duration; }
});

// 拖动音量条 → 改音量（0~100 → 0~1）
volume.addEventListener('input', function () {
    player.volume = volume.value / 100;
});

// 歌曲放完 → 清空正在播放的显示，进度条归零
player.addEventListener('ended', function () {
    playingSrc = '';
    setNowPlaying('');
    updatePlayingRow();
    setPauseBtn(false);   // 按钮回到默认的⏸
    progress.value = 0;
    progress.style.setProperty('--val', '0%');
    curTime.textContent = '0:00';
    durTime.textContent = '0:00';
});

// ===== 启动 =====
renderCategories();

// 生成星空
var stars = document.getElementById('stars');
for (var i = 0; i < 45; i++) {
    var s = document.createElement('span');
    s.className = 'star';
    var size = Math.random() * 2.5 + 1;
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 100 + '%';
    s.style.animationDelay = Math.random() * 3 + 's';
    stars.appendChild(s);
}
