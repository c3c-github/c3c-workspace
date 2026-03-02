require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const res = await conn.query("SELECT Id, Name FROM Pessoa__c WHERE Name LIKE '%Ribamar%'");
    console.log(JSON.stringify(res.records, null, 2));
}
run();
