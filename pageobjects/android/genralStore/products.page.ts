import { $ } from '@wdio/globals'
import Page from '../../page.js'
import CartPage from './cart.page.js'
class ProductsPage extends Page {
    public get toolbarTitle() {
        return $('id=com.androidsample.generalstore:id/toolbar_title')
    }

    public get productsList() {
        return $('id=com.androidsample.generalstore:id/rvProductList')
    }

    public productNameAt(index: number) {
        return $(`(id=com.androidsample.generalstore:id/productName)[${index + 1}]`)
    }

    public addToCartButtonAt(index: number) {
        return $(`(id=com.androidsample.generalstore:id/productAddCart)[${index + 1}]`)
    }

    public get cartButton() {
        return $('id=com.androidsample.generalstore:id/appbar_btn_cart')
    }

    public async waitForLoaded() {
        await this.productsList.waitForDisplayed()
    }

    public async scrollToProduct(productName: string) {
        const scrollTo = $(
            `android=new UiScrollable(new UiSelector().scrollable(true)).scrollTextIntoView("${productName}")`
        )
        await scrollTo.waitForExist({ timeout: 15000 })
    }

    public async addProductToCartByName(productName: string) {
        await this.waitForLoaded()
        await this.scrollToProduct(productName)

        const addBtn = await $(
            `//*[@text="${productName}"]/ancestor::android.widget.LinearLayout//*[@resource-id="com.androidsample.generalstore:id/productAddCart"]`
        )
    
        await addBtn.waitForDisplayed()
        await addBtn.click()
        return this
    }

    public async addProductToCartByIndex(index: number) {
        await this.waitForLoaded()
        const btn = this.addToCartButtonAt(index)
        await btn.waitForDisplayed()
        await btn.click()
        return ProductsPage
    }

    public async openCart() {
        await this.cartButton.waitForDisplayed()
        await this.cartButton.click()
        return  CartPage
    }
}

export default new ProductsPage()
