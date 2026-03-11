Id periodId = 'a1EN5000002Gw25MAC';

// 1. Mudar status do período para Liberado para Nota Fiscal
update new Periodo__c(Id = periodId, Status__c = 'Liberado para Nota Fiscal');

// 2. Garantir que não há nota fiscal atrapalhando o teste
delete [SELECT Id FROM NotaFiscal__c WHERE Periodo__c = :periodId];

System.debug('Teste preparado: Período ' + periodId + ' agora está LIBERADO PARA NOTA FISCAL.');
