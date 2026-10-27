"""Public-page checks: exact evidence/media retained, with no machine paths or inbound navigation."""
import base64,gzip,hashlib,json,re,unittest
from html.parser import HTMLParser
from pathlib import Path
SITE=Path(__file__).resolve().parents[1]/'site'
CASE=SITE/'investigations/scout-goat'
def payload(page,id):
 match=re.search(r'<script id="'+id+r'"[^>]*>(.*?)</script>',page,re.S)
 if 'data-encoding="gzip-base64"' in match[0]:return json.loads(gzip.decompress(base64.b64decode(match[1])))
 return json.loads(match[1])
class PublicCaseTests(unittest.TestCase):
 def test_direct_page_requests_noindex(self):
  page=(CASE/'index.html').read_text()
  self.assertIn('<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">',page)
  self.assertIn('id="shared-scene"',page)
  self.assertIn('scene/scout-goat-genie.mp4',page)
 def test_dashboard_and_trends_do_not_link_case(self):
  for name in ('index.html','app.js','trends.html'):
   text=(SITE/name).read_text()
   self.assertNotIn('investigations/',text)
   self.assertNotIn('scout-goat',text)
 def test_public_copy_has_no_local_paths(self):
  for path in CASE.rglob('*'):
   if path.suffix in ('.html','.md','.json'):
    text=path.read_text()
    self.assertIsNone(re.search(r'/(?:home|tmp|mnt|media)/|file://|76561198103155319',text),str(path))
 def test_links_and_file_hashes(self):
  class Links(HTMLParser):
   def handle_starttag(self,tag,attrs):
    for key,value in attrs:
     if key in ('src','href','poster') and not value.startswith(('http:','https:','#','data:')):
      target=(CASE/value.split('#')[0]).resolve()
      if not target.is_file():raise AssertionError(value)
  Links().feed((CASE/'index.html').read_text())
  for name,digest in json.loads((CASE/'files.sha256.json').read_text()).items():
   self.assertEqual(hashlib.sha256((CASE/name).read_bytes()).hexdigest(),digest,name)
 def test_embedded_evidence_still_localizes_both_objects(self):
  page=(CASE/'index.html').read_text();data=payload(page,'data')
  self.assertNotIn('path',data['candidate'])
  self.assertNotIn('assets_directory',data['provenance']['build'])
  self.assertEqual(data['report'],json.loads((CASE/'report.json').read_text()))
  first={o['id']:o['first_tick'] for o in data['report']['objects']}
  self.assertEqual(first,{3031:829,3250:839})
  scene=payload(page,'shared-scene-data')
  self.assertEqual(scene['summary']['nearby_objects'],15)
  self.assertEqual(scene['summary']['onset_time'],13156)
 def test_compressed_scene_retains_all_embedded_numerical_evidence(self):
  page=(CASE/'index.html').read_text()
  embedded=payload(page,'shared-scene-data')
  with gzip.open(CASE/'scene/scene.json.gz','rt') as stream:download=json.load(stream)
  self.assertEqual(embedded,download)
  self.assertEqual(len(download['info']),15)
 def test_every_difference_row_is_valid_and_contiguous(self):
  rows=list(map(json.loads,gzip.open(CASE/'differences.jsonl.gz','rt')))
  self.assertEqual([r['tick_index'] for r in rows],list(range(999)))
  self.assertEqual(rows[829]['differences'][0]['id'],3031)
if __name__=='__main__':unittest.main()
