const contaAzulService = require('../src/services/contaAzulService');
const { getSfConnection } = require('../src/config/salesforce');

// Mock de sessão/conexão se necessário, mas o serviço cria a própria.
// Vamos apenas chamar a função.

async function test() {
    console.log("Iniciando teste de conexão Conta Azul...");
    try {
        const results = await contaAzulService.searchCustomers('');
        console.log("Sucesso! Registros encontrados:", results.length);
        if(results.length > 0) {
            console.log("Exemplo de registro:", results[0]);
        } else {
            console.log("Nenhum registro retornado. Verifique se há clientes na base de teste.");
        }
    } catch (e) {
        console.error("ERRO NO TESTE:", e);
    }
}

test();