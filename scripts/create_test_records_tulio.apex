Id pessoaId = 'a14N5000009ZEanIAG';
Id contratoId = 'a16N50000046HlRIAU';
Id responsavelId = 'a1FN5000000It4TMAS';

// 1. Criar Período Fevereiro 2026 (11/02 a 10/03)
Periodo__c p = new Periodo__c(
    Name = 'Fevereiro 2026 - Tulio Sales',
    ContratoPessoa__c = contratoId,
    DataInicio__c = Date.newInstance(2026, 2, 11),
    DataFim__c = Date.newInstance(2026, 3, 10),
    Status__c = 'Nota em Validação'
);
insert p;

// 2. Criar DiaPeriodo
DiaPeriodo__c dp = new DiaPeriodo__c(
    Periodo__c = p.Id,
    Data__c = Date.newInstance(2026, 2, 15),
    Tipo__c = 'Útil'
);
insert dp;

// 3. Criar Lançamento de Hora
// Buscando o serviço vinculado a esse responsável
Responsavel__c resp = [SELECT Id, Servico__c FROM Responsavel__c WHERE Id = :responsavelId];
Atividade__c act = [SELECT Id FROM Atividade__c LIMIT 1];

LancamentoHora__c lh = new LancamentoHora__c(
    DiaPeriodo__c = dp.Id,
    Responsavel__c = responsavelId,
    Servico__c = resp.Servico__c,
    Horas__c = 8,
    Status__c = 'Aprovado',
    Atividade__c = act.Id
);
insert lh;

// 4. Criar Nota Fiscal fake
NotaFiscal__c nf = new NotaFiscal__c(
    Periodo__c = p.Id,
    Tipo__c = 'Entrada',
    Status__c = 'Em Revisão',
    Valor__c = 1500.00,
    CNPJ_Emissor__c = '12345678000199',
    CNPJ_Receptor__c = '34268618000159',
    NumeroNota__c = 'TEST-999',
    DataEmissao__c = Date.newInstance(2026, 3, 5),
    NomeEmitente__c = 'Tulio Tech ME',
    Preenchimento__c = 'Automático'
);
insert nf;

System.debug('Teste criado para Tulio Sales. Período: ' + p.Id);
