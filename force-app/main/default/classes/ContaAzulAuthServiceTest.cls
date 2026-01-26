@isTest
public class ContaAzulAuthServiceTest {
    
    @testSetup
    static void setup() {
        insert new Configuracao__c(
            ClientId__c = 'client_id',
            ClientSecret__c = 'client_secret',
            Refresh_Token__c = 'refresh_token',
            Token__c = 'access_token',
            Data_Expiracao__c = Datetime.now().addHours(1)
        );
    }

    @isTest
    static void testGetAuthenticationValid() {
        Test.startTest();
        ContaAzulAuthService.AuthResult res = ContaAzulAuthService.getAuthentication();
        Test.stopTest();
        
        System.assertNotEquals(null, res.accessToken);
        System.assertEquals(null, res.configParaAtualizar);
    }

    @isTest
    static void testGetAuthenticationRefresh() {
        // Expira o token
        Configuracao__c conf = [SELECT Id FROM Configuracao__c LIMIT 1];
        conf.Data_Expiracao__c = Datetime.now().addMinutes(-10);
        update conf;

        Test.setMock(HttpCalloutMock.class, new ContaAzulMock());

        Test.startTest();
        ContaAzulAuthService.AuthResult res = ContaAzulAuthService.getAuthentication();
        Test.stopTest();
        
        System.assertEquals('mock_token', res.accessToken);
        System.assertNotEquals(null, res.configParaAtualizar);
    }

    @isTest
    static void testTokenResponseDTO() {
        // Cobertura para a classe DTO
        ContaAzulTokenResponse dto = new ContaAzulTokenResponse();
        dto.access_token = 'a';
        dto.refresh_token = 'b';
        dto.expires_in = 10;
        System.assertEquals('a', dto.access_token);
    }
}