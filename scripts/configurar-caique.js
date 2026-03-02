require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009Z735IAC'; // Caique
    const endDate = '2026-01-31';
    const startDate = '2026-02-01';
    const originalEndDate = '2026-12-31';

    console.log(`🚀 Iniciando configuração para Caique (${targetId})...`);

    // --- 1. ENCERRAR ATUAIS ---
    const qAtuais = `SELECT Id FROM Alocacao__c WHERE Pessoa__c = '${targetId}' AND (DataFim__c = NULL OR DataFim__c > ${endDate})`;
    const resAtuais = await conn.query(qAtuais);
    if (resAtuais.totalSize > 0) {
        const updates = resAtuais.records.map(r => ({ Id: r.Id, DataFim__c: endDate }));
        await conn.sobject('Alocacao__c').update(updates);
        console.log(`✅ ${updates.length} alocações antigas encerradas.`);
    }

    // --- 2. CRIAR NOVAS ---
    const targetServices = ['Karina Plásticos | Suporte', 'Apodi | Suporte', 'C3C Software | Suporte'];
    const whereClause = targetServices.map(t => `Name = '${t}'`).join(' OR ');
    
    const qServ = `SELECT Id, Name FROM Servico__c WHERE Tipo__c = 'Suporte' AND (${whereClause})`;
    const resServ = await conn.query(qServ);
    
    const newAllocs = resServ.records.map(s => {
        const name = s.Name.toLowerCase();
        let pct = 0;
        if (name.includes('karina') || name.includes('apodi')) pct = 50;

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

    // --- 3. GRUPOS (OPERACAO, GESTAO_SUPORTE) ---
    const groups = ['OPERACAO', 'GESTAO_SUPORTE'];
    const qGroups = `SELECT Id, Codigo__c FROM GrupoPermissao__c WHERE Codigo__c IN ('${groups.join("','")}')`;
    const resGroups = await conn.query(qGroups);
    
    const membersToCreate = [];
    for (const g of resGroups.records) {
        const qCheck = `SELECT Id FROM MembroGrupo__c WHERE Pessoa__c = '${targetId}' AND Grupo__c = '${g.Id}'`;
        const resCheck = await conn.query(qCheck);
        if (resCheck.totalSize === 0) {
            membersToCreate.push({ Pessoa__c: targetId, Grupo__c: g.Id });
            console.log(`➕ Adicionando ao grupo: ${g.Codigo__c}`);
        }
    }

    if (membersToCreate.length > 0) {
        await conn.sobject('MembroGrupo__c').create(membersToCreate);
        console.log(`✅ Permissões de liderança atribuídas.`);
    }
}

run();
