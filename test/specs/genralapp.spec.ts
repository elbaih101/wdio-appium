import HomePage from '../../pageobjects/android/genralStore/home.page.js'
import { createTestData, TestData } from '../../utils/test.data.js'

describe('Genral Store App', () => {
  let testData:TestData
    it('add item to cart and check it exist in cart screen', async () => {
      testData = createTestData("genralStore.json");
    (await
      (await 
        (await 
        HomePage.fillForm({name: testData.get("customer.name"), gender: testData.get("customer.gender"), country: testData.get("customer.country")})
      ).
        addProductToCartByName(testData.get("product"))
      ).openCart()
    ).assertCartItemExists(testData.get("product"))
        
    })
})

