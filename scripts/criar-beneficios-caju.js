require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function createWithRetry(conn, record, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const result = await conn.sobject('BeneficioPessoa__c').create(record);
            return result;
        } catch (err) {
            if (i === retries - 1) throw err;
            console.warn(`⚠️ Tentativa ${i + 1} falhou para ${record.Name}. Tentando novamente em 3s...`);
            await sleep(3000);
        }
    }
}

async function run() {
    let conn = await getSfConnection();
    const people = [
        { id: 'a14N5000009ZBczIAG', name: 'Davi Robert Duarte dos Santos' },
        { id: 'a14N5000009ZEKgIAO', name: 'Robson Jose Dias Venancio' },
        { id: 'a14N5000009ZF2EIAW', name: 'Victor Lucas da Silva Moreira' },
        { id: 'a14N5000009ZGHeIAO', name: 'Jose Valter Moreira de Araujo Junior' },
        { id: 'a14N5000009ZGKrIAO', name: 'Isabelle Alves da Silva' },
        { id: 'a14N5000009ZGPiIAO', name: 'Jose Anderson Oliveira de Lima' },
        { id: 'a14N5000009ZGRJIA4', name: 'Joao Victor Sales Teixeira' },
        { id: 'a14N5000009ZGcbIAG', name: 'Renan de Castro Rodrigues' },
        { id: 'a14N5000009Zj1uIAC', name: 'Manoel Francisco de Paiva Neto' },
        { id: 'a14N500000AAJ21IAH', name: 'Arthur Brito' },
        { id: 'a14N500000Bd9t7IAB', name: 'Renan Rocha Tenorio de Carles' },
        { id: 'a14N500000CBp1tIAD', name: 'Matheus Verissimo Gonzalez' },
        { id: 'a14N500000CjuGrIAJ', name: 'Jezrrel Toshio Imai' },
        { id: 'a14N500000Cjvb7IAB', name: 'Ezequiel Cordeiro' }
    ];

    const records = people.map(p => ({
        Name: `Caju | ${p.name}`,
        Pessoa__c: p.id,
        Valor__c: 700.00,
        DataInicio__c: '2026-02-02'
    }));

    console.log(`🚀 Iniciando criação de ${records.length} benefícios com retry...`);

    let successCount = 0;
    for (const record of records) {
        try {
            const result = await createWithRetry(conn, record);
            if (result.success) {
                successCount++;
                console.log(`✅ Criado: ${record.Name}`);
            } else {
                console.error(`❌ Erro em [${record.Name}]:`, result.errors);
            }
            await sleep(500); // Pequena pausa entre registros
        } catch (e) {
            console.error(`❌ Erro fatal no registro ${record.Name}:`, e.message);
            // Tenta restabelecer conexão para o próximo
            try { conn = await getSfConnection(); } catch(reconnErr) {}
        }
    }
    console.log(`
🏁 Concluído! ${successCount}/${records.length} benefícios criados.`);
}

run();