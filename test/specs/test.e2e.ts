import HomePage from '../../pageobjects/android/genralStore/home.page.js'

describe('Genral Store App', () => {
    it('add item to cart and check it exist in cart screen', async () => {
    (await
      (await 
        (await 
        HomePage.fillForm({name: 'John Doe', gender: 'male', country: 'Andorra'})
      ).
        addProductToCartByName("Air Jordan 4 Retro")
      ).openCart()
    ).assertCartItemExists("Air Jordan 4 Retro")
  
      
    })
})

