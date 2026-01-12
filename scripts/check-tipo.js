require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function checkTipoPicklist() {
    const conn = await getSfConnection();
    const meta = await conn.sobject('Servico__c').describe();
    const field = meta.fields.find(f => f.name === 'Tipo__c');
    if (field) {
        console.log("Valores de Tipo__c:", field.picklistValues.map(v => v.value));
    } else {
        console.log("Campo Tipo__c não encontrado.");
    }
}
checkTipoPicklist();
