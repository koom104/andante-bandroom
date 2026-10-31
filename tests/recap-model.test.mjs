import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecapLoader, formatRecapMinutes, isCoverUrl, isTrackUrl, parseAlbumMatches, recapMonths, recapStoryPages, recapStoryTheme, pickAutomaticCover, mostRehearsedSong, storyTrackLayout, recapAlbumSearchParams, recapBackgroundSongs, recapBackgroundSong } from '../app/recap-model.ts';

test('story background defaults to most rehearsed song but can select another without changing statistics', () => {
  const teams = [
    {team_id:'a',team_name:'Song A',minutes:30,sessions:1,cover:null},
    {team_id:'b',team_name:'Song B',minutes:90,sessions:3,cover:null},
    {team_id:'c',team_name:' Song A ',minutes:40,sessions:2,cover:{track_id:4}},
  ];
  const snapshot=structuredClone(teams);
  assert.equal(recapBackgroundSong(teams).team_id,'b');
  assert.equal(recapBackgroundSong(teams,'a').team_name,'Song A');
  assert.equal(recapBackgroundSong(teams,'a').cover.track_id,4);
  assert.equal(recapBackgroundSong(teams,'missing').team_id,'b');
  assert.equal(recapBackgroundSong([]),null);
  assert.deepEqual(recapBackgroundSongs(teams).map(song=>song.minutes),[90,70]);
  assert.deepEqual(teams,snapshot);
});

test('Japanese album searches use the Japanese catalog and original title language', () => {
  for (const query of ['好きだから。', '好きだから。 ユイカ', 'ユイカ', 'ﾕｲｶ', '夜に駆ける']) {
    const params = recapAlbumSearchParams(query);
    assert.equal(params.get('country'), 'JP');
    assert.equal(params.get('lang'), 'ja_jp');
    assert.equal(params.get('entity'), 'song');
    assert.equal(params.get('limit'), '8');
  }
  for (const query of ['2002', 'I Really Want to Stay At Your House', '한국어로 등록한 다른 곡']) {
    assert.equal(recapAlbumSearchParams(query).get('country'), 'US');
  }
});

test('confirmed Korean titles resolve original titles and require the correct artist', () => {
  for (const [query, title, artist, country] of [
    ['히치콕', 'ヒッチコック', 'ヨルシカ', 'JP'],
    ['친애하는 소년이여', '拝啓、少年よ', 'Hump Back', 'JP'],
    ['유이카 스키다카라', '好きだから。', '『ユイカ』', 'JP'],
    ['예뻤어', 'You Were Beautiful', 'DAY6', 'US'],
    ['아이유 밤편지', 'Through the Night', 'IU', 'US'],
  ]) {
    const params = recapAlbumSearchParams(query);
    assert.equal(params.get('country'),country);
    assert.ok(params.get('term').includes(title));
    const original={track_name:title,artist_name:artist};
    assert.equal(pickAutomaticCover(query,[{...original,artist_name:'Cover singer'},original]),original);
    assert.equal(pickAutomaticCover(query,[{...original,artist_name:'Cover singer'}]),null);
    assert.equal(pickAutomaticCover(query,[{...original,track_name:title+' (Karaoke)'}]),null);
  }
  assert.equal(pickAutomaticCover('한국어로 등록한 다른 곡',[{track_name:'Unrelated',artist_name:'IU'}]),null);
});

test('Yuika original Japanese title remains eligible for automatic cover matching', () => {
  const original = { track_name: '好きだから。', artist_name: '『ユイカ』' };
  assert.equal(pickAutomaticCover('好きだから。', [original, { ...original, track_name: '好きだから。 (Piano ver.)' }]), original);
});

test('album covers stay vertically centered and content fits for one to fourteen tracks', () => {
  for(let count=1;count<=14;count++)for(let index=0;index<count;index++){
    const row=storyTrackLayout(count,index);
    assert.ok(Math.abs((row.artY+row.artSize/2)-(row.cardY+row.cardHeight/2))<.0001,`${count} tracks: cover centered`);
    assert.ok(row.artY>=row.cardY);assert.ok(row.artY+row.artSize<=row.cardY+row.cardHeight);
    if (!row.roomy) {
      assert.ok(row.textX + row.textWidth + 28 <= row.timeRight - row.timeWidth);
      assert.ok(row.subtitleY < row.meterY - 4);
      assert.ok(row.titleY - 30 >= row.cardY + 4);
    }
    const meterY=row.roomy?row.contentY+188:row.y+row.step-18;
    assert.ok(meterY+(row.roomy?5:3)<=row.cardY+row.cardHeight,`${count} tracks: meter fits`);
    assert.ok(row.cardY+row.cardHeight<1670);
  }
});

test('background song combines participation across performance teams without changing their records', () => {
  const teams=[{team_name:'Same song',minutes:60,sessions:1,cover:null},{team_name:' SAME SONG ',minutes:90,sessions:2,cover:{track_id:1}},{team_name:'Other',minutes:120,sessions:3,cover:null}];
  const top=mostRehearsedSong(teams);assert.equal(top.minutes,150);assert.equal(top.cover.track_id,1);
  assert.equal(teams[0].minutes,60);assert.equal(teams[1].minutes,90);assert.equal(mostRehearsedSong([]),null);
});

test('automatic art accepts exact titles but rejects ambiguous artists and approximate matches', () => {
  const cover={track_name:'I Really Want to Stay At Your House',artist_name:'Rosa Walton'};
  assert.equal(pickAutomaticCover('I REALLY WANT TO STAY AT YOUR HOUSE!', [cover]),cover);
  assert.equal(pickAutomaticCover('Different song',[cover]),null);
  assert.equal(pickAutomaticCover(cover.track_name,[cover,{...cover,artist_name:'Another artist'}]),cover);
  assert.equal(pickAutomaticCover(cover.track_name,[{...cover,track_name:'Unrelated'},cover,{...cover,artist_name:'Another artist'}]),null);
  assert.equal(pickAutomaticCover(cover.track_name,[cover,{...cover}]),cover);
});

test('pastel performance themes are stable and adapt to the visible page', () => {
  assert.equal(recapStoryTheme([{goals:['여름공연']}]).background,'#d8eee0');
  assert.equal(recapStoryTheme([{goals:['가을축제(총학생회)']}]).background,'#f7d9cf');
  assert.equal(recapStoryTheme([{goals:['겨울공연']}]).background,'#dce9f5');
  assert.equal(recapStoryTheme([{goals:['동연제']}]).background,'#eadff4');
  assert.deepEqual(recapStoryTheme([{goals:['동연제']},{goals:['여름공연']},{goals:['동연제']}]),recapStoryTheme([{goals:['동연제']}]));
});

test('story starts with performance totals, then paginates every song without loss', () => {
  const teams=Array.from({length:43},(_,i)=>({team_id:String(i)}));
  const pages=recapStoryPages({teams,goals:[{name:'Summer',minutes:30,sessions:1}]});
  assert.equal(pages.length,5); assert.equal(pages[0].kind,'goals');
  const ids=pages.filter(p=>p.kind==='songs').flatMap(p=>teams.slice(p.offset,p.offset+p.count).map(t=>t.team_id));
  assert.deepEqual(ids,teams.map(t=>t.team_id));
  assert.equal(recapStoryPages({teams:teams.slice(0,14),goals:[]}).length,2);
  assert.equal(recapStoryPages({teams:teams.slice(0,15),goals:[]}).length,3);
});

test('recap counts minutes without rounding partial participation', () => {
  assert.equal(formatRecapMinutes(90), '1시간 30분');
  assert.equal(formatRecapMinutes(30), '30분');
  assert.equal(formatRecapMinutes(0), '0분');
});
test('album URLs reject unrelated domains and injected credentials', () => {
  assert.ok(isCoverUrl('https://is1-ssl.mzstatic.com/image/a.jpg'));
  for (const url of ['http://is1.mzstatic.com/a', 'https://is1.mzstatic.com.evil.com/a', 'https://user@is1.mzstatic.com/a']) assert.equal(isCoverUrl(url), false);
  assert.equal(isTrackUrl('javascript:alert(1)'), false);
  assert.equal(isTrackUrl('https://music.apple.com.evil.com/'), false);
  assert.ok(isTrackUrl('https://music.apple.com/us/album/123'));
});
test('album parsing drops invalid records and limits results', () => {
  const song = { kind: 'song', trackId: 1, trackName: 'Track', artistName: 'Artist', artworkUrl100: 'https://is1.mzstatic.com/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/us/album/1' };
  assert.equal(parseAlbumMatches({ results: Array(12).fill(song) }).length, 8);
  assert.match(parseAlbumMatches({ results: [song] })[0].artwork_url, /400x400bb/);
  assert.deepEqual(parseAlbumMatches({ results: [{ ...song, trackViewUrl: 'https://evil.com' }] }), []);
});
test('month chart includes January through December in order, hiding zero activity', () => {
  const input = [{month:'2026-12',minutes:75},{month:'2026-01',minutes:30},{month:'2026-03',minutes:60},
    {month:'2026-02',minutes:0},{month:'2025-12',minutes:90},{month:'2026-04',minutes:0}];
  assert.deepEqual(recapMonths(input,2026),[
    {month:'2026-01',minutes:30},{month:'2026-03',minutes:60},{month:'2026-12',minutes:75}]);
  assert.equal(recapMonths(input,null)[0].month,'2025-12');
  assert.equal(recapMonths(input,null).length,4);
  assert.deepEqual(recapMonths([],2026),[]);
  assert.deepEqual(recapMonths([{month:'2026-01',minutes:0}],2026),[]);
  assert.deepEqual(recapMonths([{month:'2026-03',minutes:75},{month:'2026-03',minutes:15}],2026),[{month:'2026-03',minutes:90}]);
});
test('summary requests coalesce and cache separately by account and year', async () => {
  let calls = 0;
  const load = createRecapLoader(async (user, year) => ({ user, year, call: ++calls }));
  const [a, b] = await Promise.all([load('a', 2026), load('a', 2026)]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  await load('a', 2026); assert.equal(calls, 1);
  await load('b', 2026); await load('a', null); assert.equal(calls, 3);
  await load('a', 2026, true); assert.equal(calls, 4);
});
test('failed summaries can be retried, expired summaries refresh', async () => {
  let calls = 0;
  const load = createRecapLoader(async () => { if (++calls === 1) throw Error('offline'); return calls; }, 0);
  await assert.rejects(load('a', null));
  assert.equal(await load('a', null), 2); assert.equal(await load('a', null), 3);
});
