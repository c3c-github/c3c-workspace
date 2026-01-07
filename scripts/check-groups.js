require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function debugUserGroups() {
    const conn = await getSfConnection();
    
    console.log("🔍 Buscando usuários e seus grupos...");
    
    // Busca usuários que tenham email preenchido
    const soql = `
        SELECT Id, Name, Email__c,
               (SELECT Grupo__r.Codigo__c FROM GruposDePermissao__r)
        FROM Pessoa__c 
        WHERE Email__c != null
    `;
    
    const result = await conn.query(soql);
    
    console.log(`\nEncontrados ${result.totalSize} usuários.`);
    
    result.records.forEach(p => {
        let grupos = [];
        if (p.GruposDePermissao__r && p.GruposDePermissao__r.records) {
            grupos = p.GruposDePermissao__r.records.map(m => {
                if (!m.Grupo__r) return "NULL_GRUPO_R";
                return m.Grupo__r.Codigo__c;
            });
        }
        
        console.log(`\n👤 ${p.Name} (${p.Email__c})`);
        console.log(`   Grupos: [${grupos.join(', ')}]`);
        
        if (grupos.length === 0) {
            console.log("   ⚠️  Nenhum grupo encontrado via relacionamento.");
        }
    });
}

debugUserGroups();

