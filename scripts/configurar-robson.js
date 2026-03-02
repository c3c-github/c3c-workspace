require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZEKgIAO'; // Robson
    const ribamarId = 'a14N5000009ZGSvIAO';
    const endDate = '2026-01-31';
    const startDate = '2026-02-01';
    const originalEndDate = '2026-12-31';

    console.log(`🚀 Iniciando configuração para Robson (${targetId})...`);

    // --- 1. ENCERRAR ATUAIS ---
    const qAtuais = `SELECT Id FROM Alocacao__c WHERE Pessoa__c = '${targetId}' AND (DataFim__c = NULL OR DataFim__c > ${endDate})`;
    const resAtuais = await conn.query(qAtuais);
    if (resAtuais.totalSize > 0) {
        const updates = resAtuais.records.map(r => ({ Id: r.Id, DataFim__c: endDate }));
        await conn.sobject('Alocacao__c').update(updates);
        console.log(`✅ ${updates.length} alocações antigas encerradas.`);
    }

    // --- 2. BUSCAR SERVIÇOS DO RIBAMAR E CRIAR PARA ROBSON ---
    const qRibamar = `SELECT Servico__c, Servico__r.Name FROM Alocacao__c WHERE Pessoa__c = '${ribamarId}' AND DataInicio__c = ${startDate}`;
    const resRibamar = await conn.query(qRibamar);
    
    if (resRibamar.totalSize === 0) {
        console.error("❌ Nenhuma alocação do Ribamar encontrada para copiar.");
    } else {
        const newAllocs = resRibamar.records.map(r => {
            const name = r.Servico__r.Name.toLowerCase();
            let pct = 0;
            
            if (name.includes('cherry')) pct = 33;
            else if (name.includes('zanchetta')) pct = 21;
            else if (name.includes('compre e alugue agora')) pct = 21;
            else if (name.includes('psafe')) pct = 21;

            console.log(`   - Criando para: ${r.Servico__r.Name} (${pct}%)`);
            return {
                Pessoa__c: targetId,
                Servico__c: r.Servico__c,
                DataInicio__c: startDate,
                DataFimOriginal__c: originalEndDate,
                Percentual__c: pct
            };
        });

        const ret = await conn.sobject('Alocacao__c').create(newAllocs);
        console.log(`✅ ${ret.filter(r => r.success).length} novas alocações criadas.`);
    }

    // --- 3. GRUPO OPERAÇÃO ---
    const qGrupo = `SELECT Id FROM GrupoPermissao__c WHERE Codigo__c = 'OPERACAO' LIMIT 1`;
    const resGrupo = await conn.query(qGrupo);
    if (resGrupo.totalSize > 0) {
        const grupoId = resGrupo.records[0].Id;
        const qCheck = `SELECT Id FROM MembroGrupo__c WHERE Pessoa__c = '${targetId}' AND Grupo__c = '${grupoId}'`;
        const resCheck = await conn.query(qCheck);
        if (resCheck.totalSize === 0) {
            await conn.sobject('MembroGrupo__c').create({ Pessoa__c: targetId, Grupo__c: grupoId });
            console.log(`✅ Adicionado ao grupo OPERACAO.`);
        } else {
            console.log(`ℹ️  Já é membro do grupo OPERACAO.`);
        }
    }
}

run();
