require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function inspectObjects() {
    try {
        const conn = await getSfConnection();
        
        const objectsToInspect = ['Servico__c', 'Contrato__c', 'LancamentoLancamentoHora__c', 'Alocacao__c', 'DiaPeriodo__c'];
        
        console.log("🔍 Iniciando inspeção de objetos...");

        for (const objName of objectsToInspect) {
            try {
                const meta = await conn.sobject(objName).describe();
                console.log(`\n📦 Objeto: ${objName}`);
                console.log(`   Label: ${meta.label}`);
                
                // Relacionamentos Child (Quem aponta para este objeto?)
                console.log("   👶 Child Relationships (Quem é filho deste objeto?):");
                meta.childRelationships.forEach(cr => {
                    if (cr.relationshipName) {
                        console.log(`      - ${cr.relationshipName} (Objeto Filho: ${cr.childSObject})`);
                    }
                });

                // Campos (Para validar nomes de API)
                console.log("   📝 Campos Importantes:");
                meta.fields.forEach(f => {
                    // Filtra alguns campos padrão para reduzir ruído
                    if (f.name.endsWith('__c') || ['AccountId', 'ContactId'].includes(f.name)) {
                        console.log(`      - ${f.name} (${f.label}) [Type: ${f.type}]`);
                    }
                });

            } catch (err) {
                console.error(`❌ Erro ao descrever ${objName}: ${err.message}`);
            }
        }

    } catch (e) {
        console.error("Erro Geral:", e);
    }
}

inspectObjects();
