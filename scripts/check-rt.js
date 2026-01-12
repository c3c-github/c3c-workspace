require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function checkRecordTypes() {
    try {
        const conn = await getSfConnection();
        // RecordType é um objeto padrão
        const q = `SELECT Id, Name, DeveloperName FROM RecordType WHERE SobjectType = 'Servico__c'`;
        const res = await conn.query(q);
        console.log("Tipos de Registro de Serviço:", res.records);
    } catch (e) { console.error(e); }
}
checkRecordTypes();
