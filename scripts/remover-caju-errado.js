require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const allowedIds = [
        'a14N5000009ZBczIAG', 'a14N5000009ZEKgIAO', 'a14N5000009ZF2EIAW', 
        'a14N5000009ZGHeIAO', 'a14N5000009ZGKrIAO', 'a14N5000009ZGPiIAO', 
        'a14N5000009ZGRJIA4', 'a14N5000009ZGcbIAG', 'a14N5000009Zj1uIAC', 
        'a14N500000AAJ21IAH', 'a14N500000Bd9t7IAB', 'a14N500000CBp1tIAD', 
        'a14N500000CjuGrIAJ', 'a14N500000Cjvb7IAB'
    ];

    console.log("🗑️  Iniciando remoção dos registros incorretos criados hoje...");

    try {
        // 1. Busca BeneficioPessoa__c criados hoje para esses IDs
        const qBeneficios = `
            SELECT Id 
            FROM BeneficioPessoa__c 
            WHERE Pessoa__c IN ('${allowedIds.join("','")}')
            AND CreatedDate = TODAY
            AND Name LIKE 'Caju %'
        `;
        const resBeneficios = await conn.query(qBeneficios);
        
        if (resBeneficios.totalSize === 0) {
            console.log("✅ Nenhum benefício encontrado para remover.");
            return;
        }

        const beneficioIds = resBeneficios.records.map(r => r.Id);
        console.log(`⚠️  Encontrados ${beneficioIds.length} BeneficioPessoa__c.`);

        // 2. Busca BeneficioPeriodo__c vinculados
        const qVinculos = `
            SELECT Id 
            FROM BeneficioPeriodo__c 
            WHERE BeneficioPessoa__c IN ('${beneficioIds.join("','")}')
        `;
        const resVinculos = await conn.query(qVinculos);
        const vinculoIds = resVinculos.records.map(r => r.Id);
        console.log(`⚠️  Encontrados ${vinculoIds.length} BeneficioPeriodo__c vinculados.`);

        // 3. Exclui tudo (Vínculos primeiro)
        if (vinculoIds.length > 0) {
            await conn.sobject('BeneficioPeriodo__c').destroy(vinculoIds);
            console.log(`✅ Vínculos removidos.`);
        }
        
        if (beneficioIds.length > 0) {
            await conn.sobject('BeneficioPessoa__c').destroy(beneficioIds);
            console.log(`✅ Benefícios base removidos.`);
        }

        console.log("\n🏁 Limpeza concluída!");

    } catch (e) {
        console.error("❌ Erro fatal:", e.message);
    }
}

run();
