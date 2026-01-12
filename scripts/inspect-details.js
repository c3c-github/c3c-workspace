require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function inspectDetails() {
    try {
        const conn = await getSfConnection();
        
        // 1. Verificar para onde aponta Servico__c.Contrato__c
        const servicoMeta = await conn.sobject('Servico__c').describe();
        const contratoField = servicoMeta.fields.find(f => f.name === 'Contrato__c');
        console.log("\n🔗 Servico__c.Contrato__c aponta para:", contratoField.referenceTo);

        // 2. Verificar valores de picklist de DiaPeriodo__c.Tipo__c
        const diaMeta = await conn.sobject('DiaPeriodo__c').describe();
        const tipoField = diaMeta.fields.find(f => f.name === 'Tipo__c');
        console.log("\n📅 DiaPeriodo__c.Tipo__c valores:");
        tipoField.picklistValues.forEach(v => console.log(`   - ${v.value} (Label: ${v.label})`));

        // 3. Verificar LancamentoHora__c
        console.log("\n📦 Verificando objeto LancamentoHora__c...");
        const lancMeta = await conn.sobject('LancamentoHora__c').describe();
        console.log(`   Campos:`);
        lancMeta.fields.forEach(f => {
            if (f.name.includes('Hora')) console.log(`      - ${f.name}`);
        });

    } catch (e) {
        console.error(e);
    }
}

inspectDetails();
