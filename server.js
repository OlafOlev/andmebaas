const express = require('express');
const mysql = require('mysql2');
const { setIntervalAsync } = require('set-interval-async');
const pool = mysql.createPool({
    connectionLimit: 10,
    host: 'localhost',
    user: 'root',
    database: 'haaletus',
    port: 3306,
});
const app = express();
const VOTE_TIME_LIMIT = 5 * 60 * 1000; // 5 minutes in milliseconds (x * 60 * 1000)
const START_DATETIME = new Date();
let isVotingEnabled = true;
let timeLeft = VOTE_TIME_LIMIT;
setIntervalAsync(async () => {
    timeLeft -= 1000;
    if (timeLeft <= 0 && isVotingEnabled) {
        isVotingEnabled = false;
        timeLeft = 0;
        try {
            const poolt = (await pool.promise().query('SELECT COUNT(*) as count FROM HAALETUS WHERE otsus = ?', ['poolt']))[0][0].count;
            const vastu = (await pool.promise().query('SELECT COUNT(*) as count FROM HAALETUS WHERE otsus = ?', ['vastu']))[0][0].count;
            const haaletanudarv = (await pool.promise().query('SELECT COUNT(*) as count FROM TULEMUSED'))[0][0].count + 1;
            const tulemus = {
                haaletanudarv: haaletanudarv,
                h_alguse_aeg: START_DATETIME,
                poolt: poolt,
                vastu: vastu
            };
            await pool.promise().query('INSERT INTO TULEMUSED (haaletanudarv, h_alguse_aeg, poolt, vastu) VALUES (?, ?, ?, ?)', [tulemus.haaletanudarv, tulemus.h_alguse_aeg, tulemus.poolt, tulemus.vastu]);
        } catch (error) {
            console.error(error);
        }
    }
    if (timeLeft <= 0) {
        timeLeft = 0;
    }
}, 1000);
app.use(express.static('public'));
app.use(express.json());
app.post('/vote', async (req, res) => {
    const { firstName, lastName, decision } = req.body;

    try {
        const totalResults = await pool.promise().query('SELECT COUNT(*) as count FROM HAALETUS');
        const totalVotes = totalResults[0][0].count;
        if (totalVotes >= 11 && !(await hasVoted(firstName, lastName))) {
            res.status(403).send('Haaletamise limit on täis');
            return;}
        if (totalVotes >= 11 && await hasVoted(firstName, lastName)) {
            const voter = await getVoter(firstName, lastName);
            if (!voter.muutmise_aeg && timeLeft <= 0) {
                res.status(403).send('Haaletamine on läbi ja ei ole võimalik enda häält muuta');
                return;}
            await pool.promise().query('UPDATE HAALETUS SET otsus = ? WHERE eesnimi = ? AND perenimi = ?',[decision,voter.eesnimi,voter.perenimi]);
            res.status(200).send('OK');
            return;}
        const voter = await getVoter(firstName, lastName);
        if (!voter) {
            await pool.promise().query('INSERT INTO HAALETUS (eesnimi, perenimi, otsus) VALUES (?, ?, ?)', [firstName, lastName, decision]);
            res.status(200).send('OK');
            return;}
        await pool.promise().query('UPDATE HAALETUS SET otsus = ? WHERE eesnimi = ? AND perenimi = ?',[decision,voter.eesnimi,voter.perenimi]);
        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});


async function hasVoted(firstName, lastName) {
    const results = await pool.promise().query('SELECT * FROM HAALETUS WHERE eesnimi = ? AND perenimi = ?', [firstName, lastName]);
    return results[0].length > 0;
}
//a
async function getVoter(firstName, lastName) {
    const results = await pool.promise().query('SELECT * FROM HAALETUS WHERE eesnimi = ? AND perenimi = ?', [firstName, lastName]);
    return results[0][0];}
app.get('/results', (req, res) => {
    pool.query('SELECT COUNT(*) AS total FROM HAALETUS', (error, results) => {
        if (error) {
            console.error(error);
            res.status(500).send('Internal Server Error');
        } else {
            const total = results[0].total;
            pool.query('SELECT COUNT(*) AS forCount FROM HAALETUS WHERE otsus = ?', ['poolt'], (error, results) => {
                if (error) {
                    console.error(error);
                    res.status(500).send('Internal Server Error');
                } else {
                    const forCount = results[0].forCount;

                    pool.query('SELECT COUNT(*) AS againstCount FROM HAALETUS WHERE otsus = ?', ['vastu'], (error, results) => {
                        if (error) {
                            console.error(error);
                            res.status(500).send('Internal Server Error');
                        } else {
                            const againstCount = results[0].againstCount;

                            res.status(200).json({ total, forCount, againstCount, timeLeft });
                        }
                    });
                }
            });
        }
    });
});
app.listen(3000, () => {
    console.log('Server started on port http://localhost:3000');
});