require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');
const serviceController = require('../src/controllers/serviceController');

// Mock request/response
const req = {
    body: {
        id: 'a15N500000561g5IAA', // ID de um serviço existente (mock)
        name: 'Serviço Teste Parcelas',
        sf_account_id: '001N500002AgXXXXXX', // Mock Account
        ca_client_id: '5aceb6d6-654b-4bd1-9362-4fd43804214b',
        type: 'Projeto',
        start: '2025-01-01',
        
        // Vendas Vinculadas
        sales: [
            {
                id: '91f02b71-921e-4e2c-8e95-787667151d25',
                number: '270',
                emissionDate: '2025-06-06',
                total: 28850,
                status: 'APROVADO'
            }
        ],

        // Parcelas (Simulando envio do front)
        installments: [
            {
                desc: 'Venda 270 - Parcela Teste',
                month: '2025-11',
                date: '2025-11-20',
                value: 28850,
                status: 'QUITADO',
                originSaleId: '91f02b71-921e-4e2c-8e95-787667151d25'
            }
        ]
    },
    session: { user: { id: 'mock-user' } }
};

const res = {
    json: (data) => console.log('Response JSON:', JSON.stringify(data, null, 2)),
    status: (code) => ({ json: (data) => console.log(`Response ${code}:`, data) })
};

async function run() {
    console.log("Iniciando teste de saveSales (Controller Direto)...");
    try {
        // Chamando o método saveSales diretamente (simulando a rota POST /api/services/sales)
        // NOTA: O saveService (geral) chama o saveSales? Não.
        // O fluxo do front é: 1. saveService (salva serviço) -> 2. saveSales (salva vendas/parcelas)
        // O usuário reclamou que ao SALVAR (botão geral) não persiste parcelas.
        
        // Vamos testar o saveSales, pois é ele quem lida com parcelas.
        await serviceController.saveSales(req, res);
        
    } catch (error) {
        console.error("ERRO NO TESTE:", error);
    }
}

run();