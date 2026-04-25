var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.post('/waitlist', function(req, res, next) {
  const { name, email, interest } = req.body;
  console.log(name, email, interest);
  // Logic to save to database here
  res.send('Success!'); 
});

router.get('/legal/terms', function(req, res, next) {
  res.render('terms', { title: 'Terms of Service | Eporia' });
});

router.get('/legal/creator_agreement', function(req, res, next) {
  res.render('creator_agreement', { title: 'Creator Agreement | Eporia' });
});

router.get('/legal/privacy', (req, res) => res.render('privacy'));
router.get('/legal/cookie', (req, res) => res.render('cookie'));

// ── Flora Legal Routes ──
router.get('/legal/flora/terms', (req, res) => {
  res.render('flora_terms', { title: 'Terms of Service | Flora' });
});

router.get('/legal/flora/privacy', (req, res) => {
  res.render('flora_privacy', { title: 'Privacy Policy | Flora' });
});

router.get('/legal/flora/child-protection', (req, res) => {
  res.render('flora_child_protection', { title: 'Child Protection Policy | Flora' });
});

router.get('/legal/ians-sudoku-challenge/privacy', (req, res) => {
  res.render('sudoku_privacy_policy', { title: "Privacy Policy | Ian's Sudoku Challenge" });
});

// ── Jinny's Patch Tracker Legal Routes ──
router.get('/legal/jinnys-patch-tracker/privacy', (req, res) => {
  res.render('jinnys_privacy_policy', { title: "Privacy Policy | Jinny's Patch Tracker" });
});

router.get('/delete-account', function(req, res, next) {
  res.render('delete_account', { title: 'Delete Account | Flora' });
});

module.exports = router;
