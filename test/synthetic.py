"""Generate synthetic HTTP responses in a temporary test directory. No network."""
import base64,io,json,pathlib,sys,html
from PIL import Image,ImageDraw
root=pathlib.Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
im=Image.new('RGB',(960,540),'navy');draw=ImageDraw.Draw(im)
for x in range(0,960,40):draw.rectangle((x,x%300,x+20,450),fill=(x%255,120,80))
b=io.BytesIO();im.save(b,'JPEG');image=base64.b64encode(b.getvalue()).decode()
image_response={'status':200,'headers':{'content-type':'image/jpeg'},'base64':image}
E=html.escape
categories=['パイズリ','乳交','顔射','主観','お姉さん','3P、4P','3P・4P','未収録繁體・空 白','BIGセール','素人','无码破解','有码','CENSORED']
actors=['涼森れむ','三上悠亜','素人','架空テスト']
title='合成テスト作品の長いタイトル'
def save(name,code,responses):
 (root/(name+'.json')).write_text(json.dumps({'code':code,'responses':responses},ensure_ascii=False))
def links(tags):return ''.join('<a href="/genre/synthetic">'+E(s)+'</a>' for s in tags)
def javdb(code,tags=categories,names=actors,filenames=()):
 cells={'番號':code,'片商':'サンプル','日期':'2026-01-01','類別':links(tags),'演員':''.join('<a class="actor-female" href="/actors/synthetic">'+E(n)+'</a>' for n in names)}
 detail='<div class="current-title">'+title+'</div>'+''.join('<div class="panel-block"><strong>'+k+':</strong><span class="value">'+v+'</span></div>' for k,v in cells.items())+''.join('<div class="magnet-name"><span class="name">'+E(n)+'</span></div>' for n in filenames)
 return {'GET https://javdb.com/search?q='+code+'&f=all':{'body':'<div class="movie-list"><a class="box" href="/v/synthetic"><div class="video-title"><strong>'+code+'</strong></div></a></div>'},'GET https://javdb.com/v/synthetic?locale=zh':{'body':detail}}
# Official and nonofficial genre/caption cases.
url='https://www.i-dol.tv/works/detail/ome432/'
cover='https://www.i-dol.tv/contents/works/ome432/ome432-ps.jpg'
air='<dl><dt>品番</dt><dd>OME-432</dd></dl><dl><dt>タイトル</dt><dd>'+title+'</dd></dl><dl><dt>出演</dt><dd>'+''.join('<a href="/idol/detail/synthetic">'+E(n)+'</a>' for n in actors)+'</dd></dl><dl><dt>ジャンル</dt><dd>'+links(categories)+'</dd></dl><dl><dt>発売日</dt><dd>2026年1月1日</dd></dl><img src="'+cover+'">'
save('official','OME-432',{'GET '+url:{'body':air},'GET '+cover:image_response})
save('names','TEST-123',javdb('TEST-123'))
save('cap','TEST-123',javdb('TEST-123',['未収録一','巨乳','人妻']+['未収録'+str(i) for i in range(25)]+['有码']))
save('fc2','FC2-PPV-1234567',javdb('FC2-PPV-1234567'))
def three(code,image_url,printed=None,page_title=title):
 desc='品番: '+(printed or code)+' 発売日: 2026-01-01 メーカー: サンプル ジャンル: 独占配信 素人 配信専用 ナンパ フルハイビジョン(FHD) スレンダー パイパン 女子大生 Description: SyntheticSynopsisOne SyntheticSynopsisTwo'
 return '<link rel="canonical" href="https://3xplanet.com/'+code.lower()+'/"><meta name="description" content="'+E(desc)+'"><meta property="og:image" content="'+image_url+'"><h1>'+code+' '+page_title+'</h1>'
cover='https://3xplanetimg.com/covers/synthetic-gana.jpg'
# Same synthetic upstream complete-number page is available at each input URL.
responses={'GET https://3xplanet.com/'+c.lower()+'/':{'body':three('200GANA-3342',cover)} for c in ['GANA-3342','200GANA-3342']};responses['GET '+cover]=image_response
save('gana','GANA-3342',responses)
cover='https://3xplanetimg.com/covers/synthetic-hoi.jpg'
for name,filenames,printed,page_title in [('hoi',['420HOI-367.torrent'],'420HOI-367',title),('hoi-ambiguous',['420HOI-367.torrent','999HOI-367.torrent'],'420HOI-367',title),('hoi-conflict',['420HOI-367.torrent'],'420HOI-368',title),('hoi-title-mismatch',['420HOI-367.torrent'],'420HOI-367','別の作品の異なるタイトル')]:
 responses=javdb('HOI-367',filenames=filenames);responses['GET https://3xplanet.com/420hoi-367/']={'body':three('420HOI-367',cover,printed,page_title)};responses['GET '+cover]=image_response;save(name,'HOI-367',responses)
