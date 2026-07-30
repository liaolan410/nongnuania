const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Music Bot is alive and running!');
});

function keepAlive() {
    app.listen(port, () => {
        console.log(`🌐 Keep-alive server is ready on port ${port}`);
    });
}

module.exports = keepAlive;