require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGHeIAO'; // VJ
    const endDate = '2026-01-31';
    const startDate = '2026-02-01';
    const originalEndDate = '2026-12-31';

    console.log(`🚀 Iniciando configuração para VJ (${targetId})...`);

    // --- 1. ENCERRAR ATUAIS ---
    const qAtuais = `SELECT Id FROM Alocacao__c WHERE Pessoa__c = '${targetId}' AND (DataFim__c = NULL OR DataFim__c > ${endDate})`;
    const resAtuais = await conn.query(qAtuais);
    if (resAtuais.totalSize > 0) {
        const updates = resAtuais.records.map(r => ({ Id: r.Id, DataFim__c: endDate }));
        await conn.sobject('Alocacao__c').update(updates);
        console.log(`✅ ${updates.length} alocações antigas encerradas.`);
    }

    // --- 2. CRIAR NOVAS ---
    const searchTerms = ['L5 Networks | Suporte', 'MENZOIL | Suporte', 'C3C Software | Suporte'];
    const whereClause = searchTerms.map(t => `Name = '${t}'`).join(' OR ');
    
    const qServ = `SELECT Id, Name FROM Servico__c WHERE ${whereClause}`;
    const resServ = await conn.query(qServ);
    
    const newAllocs = resServ.records.map(s => {
        let pct = 0;
        if (s.Name.includes('L5')) pct = 50;
        else if (s.Name.includes('MENZOIL')) pct = 50;

        console.log(`   - Criando para: ${s.Name} (${pct}%)`);
        return {
            Pessoa__c: targetId,
            Servico__c: s.Id,
            DataInicio__c: startDate,
            DataFimOriginal__c: originalEndDate,
            Percentual__c: pct
        };
    });

    if (newAllocs.length > 0) {
        const ret = await conn.sobject('Alocacao__c').create(newAllocs);
        console.log(`✅ ${ret.filter(r => r.success).length} novas alocações criadas.`);
    }
}

run();
