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

module.exports = router;
