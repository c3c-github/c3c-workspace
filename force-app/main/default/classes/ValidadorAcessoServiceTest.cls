@isTest
private class ValidadorAcessoServiceTest {

    @isTest
    static void testValidarAcesso_ContratoAtivo() {
        // Criar dados de teste
        Pessoa__c pessoa = new Pessoa__c(Name = 'Test User', Email__c = 'test@example.com', Municipio__c = 'a13N500000SHG6lIAH');
        insert pessoa;

        ContratoPessoa__c contrato = new ContratoPessoa__c(
            Pessoa__c = pessoa.Id,
            DataInicio__c = Date.today(),
            Hora__c = 1
        );
        insert contrato;

        // Chamar o método a ser testado
        Test.startTest();
        ValidadorAcessoService.ResponseWrapper result = ValidadorAcessoService.validarAcesso('test@example.com');
        Test.stopTest();

        // Re-query the contract to get the formula field value
        contrato = [SELECT Name FROM ContratoPessoa__c WHERE Id = :contrato.Id];

        // Verificar o resultado
        System.assertEquals(true, result.acessoPermitido);
        System.assertEquals('Test User', result.nomeUsuario);
        System.assertEquals(contrato.Name, result.numeroContrato);
    }

    @isTest
    static void testValidarAcesso_ContratoInativo() {
        // Criar dados de teste
        Pessoa__c pessoa = new Pessoa__c(Name = 'Test User Inativo', Email__c = 'test.inativo@example.com', Municipio__c = 'a13N500000SHG6lIAH');
        insert pessoa;

        ContratoPessoa__c contrato = new ContratoPessoa__c(
            Pessoa__c = pessoa.Id,
            DataInicio__c = Date.today().addDays(-10),
            DataFim__c = Date.today().addDays(-1),
            Hora__c = 1
        );
        insert contrato;

        // Chamar o método a ser testado
        Test.startTest();
        ValidadorAcessoService.ResponseWrapper result = ValidadorAcessoService.validarAcesso('test.inativo@example.com');
        Test.stopTest();

        // Verificar o resultado
        System.assertEquals(false, result.acessoPermitido);
        System.assertEquals('Nenhum contrato ativo encontrado.', result.mensagem);
    }

    @isTest
    static void testValidarAcesso_NenhumContrato() {
        // Chamar o método a ser testado
        Test.startTest();
        ValidadorAcessoService.ResponseWrapper result = ValidadorAcessoService.validarAcesso('sem.contrato@example.com');
        Test.stopTest();

        // Verificar o resultado
        System.assertEquals(false, result.acessoPermitido);
        System.assertEquals('Nenhum contrato ativo encontrado.', result.mensagem);
    }
}