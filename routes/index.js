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

module.exports = router;
