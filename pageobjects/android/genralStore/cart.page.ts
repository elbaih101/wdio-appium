import { $, $$, expect } from '@wdio/globals'
import Page from '../../page.js'

class CartPage extends Page {
    public get cartList() {
        return $('com.androidsample.generalstore:id/rvCartProductList')
    }

    public get cartItemNameElements() {
        // Cart list contains multiple product cards; product names have their own resource-id.
        return $$(
            'xpath=//*[@resource-id="com.androidsample.generalstore:id/rvCartProductList"]//*[@resource-id="com.androidsample.generalstore:id/productName"]'
        )
    }

    public async assertCartItemExists(productName: string) {
        await this.cartList.waitForDisplayed()

        const names = await this.cartItemNameElements
        let found = false
        for (const el of names) {
            const text = await el.getText()
            if (text === productName) {
                found = true
                break
            }
        }

        expect(found).toBe(true)
    }

   

}

export default new CartPage()