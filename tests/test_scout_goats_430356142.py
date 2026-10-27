"""Public case evidence, links and lossless embedded delivery for replay 430356142."""
import base64,gzip,hashlib,json,re,unittest
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[1]
CASE=ROOT/'site/investigations/scout-goats-430356142'
def payload(page,id):
 m=re.search(r'<script id="'+id+r'"[^>]*>(.*?)</script>',page,re.S);assert m
 if 'data-encoding="gzip-base64"' in m[0]:return json.loads(gzip.decompress(base64.b64decode(m[1])))
 return json.loads(m[1])
class ScoutGoatsCaseTests(unittest.TestCase):
 def setUp(self):self.page=(CASE/'index.html').read_text();self.data=payload(self.page,'data');self.scene=payload(self.page,'shared-scene-data')
 def test_exact_onset_ids_and_indices(self):
  self.assertEqual({o['id']:o['first_tick'] for o in self.data['report']['objects']},{9585:290,34792:291,34795:317,34793:330})
  self.assertEqual(self.data['report']['first_divergence']['world_time'],10504)
  self.assertEqual(self.data['report']['matched_frames'],499)
 def test_checkpoint_attribution_and_capture_coverage(self):
  c=next(c for c in self.data['report']['checkpoints'][-1]['comparisons'] if c['player']==6)
  self.assertEqual([c['recorded'][7],c['ca_position_word'],c['genie_object_position_word']],[437995,437995,437939])
  self.assertEqual(sum(t['delta'] for t in c['position_contributors']),-56)
  cap=self.data['provenance']['capture_validation'];self.assertTrue(cap['complete_replay']);self.assertEqual(cap['recorded_updates'],1493);self.assertTrue(cap['all_timestamps_match'])
 def test_shared_scene_is_complete_and_lossless(self):
  with gzip.open(CASE/'scene/scene.json.gz','rt') as f:self.assertEqual(json.load(f),self.scene)
  self.assertEqual(self.scene['summary']['nearby_objects'],13)
  self.assertEqual(len(self.scene['frames']),246)
  self.assertEqual([self.scene['frames'][0]['time'],self.scene['frames'][-1]['time']],[8024,14497])
  self.assertTrue(all(str(i) in self.scene['info'] for i in [9585,34792,34793,34794,34795,9572]))
 def test_public_copy_has_no_machine_paths(self):
  for obj in (self.data,self.scene):self.assertIsNone(re.search(r'/(?:home|tmp|mnt|media)/|file://',json.dumps(obj)))
  for p in CASE.rglob('*'):
   if p.suffix in ('.html','.md','.json'):self.assertIsNone(re.search(r'/(?:home|tmp|mnt|media)/|file://',p.read_text()),str(p))
 def test_all_links_and_hashes(self):
  class Links(HTMLParser):
   def handle_starttag(self,tag,attrs):
    for key,value in attrs:
     if key in ('href','src','poster') and not value.startswith(('http:','https:','#','data:')):
      if not (CASE/value.split('#')[0]).is_file():raise AssertionError(value)
  Links().feed(self.page)
  for name,digest in json.loads((CASE/'files.sha256.json').read_text()).items():self.assertEqual(hashlib.sha256((CASE/name).read_bytes()).hexdigest(),digest,name)
 def test_not_linked_and_noindex(self):
  self.assertIn('content="noindex,nofollow,noarchive,nosnippet"',self.page)
  for name in ('index.html','app.js','trends.html'):
   self.assertNotIn('scout-goats-430356142',(ROOT/'site'/name).read_text())
 def test_rendered_positions_and_media_origin(self):
  v=json.loads((CASE/'scene/render-source-validation.json').read_text());self.assertTrue(v['every_exported_position_matches_original_genie_trace']);self.assertTrue(v['engine_core_byte_identical_to_pinned_source'])
  v=json.loads((CASE/'scene/video-validation.json').read_text());self.assertEqual(v['source_frames'],331);self.assertEqual(v['poster_recorded_index'],290);self.assertEqual(v['poster_world_time_ms'],10504);self.assertTrue(v['no_position_interpolation'])
if __name__=='__main__':unittest.main()
