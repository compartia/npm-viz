function setup(app){
    app.get('/api/info', function(req, res) {
        res.json(['polymer', 'redux', 'typeScript', 'taktik', 'ozone']);
    });
}

module.exports = setup;