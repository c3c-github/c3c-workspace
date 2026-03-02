require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function check() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGHfIAO';
    
    console.log(`\n🔍 Verificando liderança para: ${targetId}`);
    
    const query = `SELECT Id, Name, Conta__r.Name FROM Servico__c WHERE Lider__c = '${targetId}'`;
    const res = await conn.query(query);
    
    if (res.totalSize > 0) {
        console.log(`⚠️  O usuário é LÍDER nos seguintes serviços (por isso ganha acesso GESTOR):`);
        res.records.forEach(r => console.log(`   - ${r.Name} (${r.Conta__r ? r.Conta__r.Name : 'Sem Conta'})`));
    } else {
        console.log(`✅ O usuário NÃO é líder de nenhum serviço.`);
    }
}

check();
