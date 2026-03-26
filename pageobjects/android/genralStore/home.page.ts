import { $ } from '@wdio/globals'
import Page from '../../page.js'
import ProductsPage from './products.page.js'

type Gender = 'male' | 'female'

class HomePage extends Page {
    public get nameField() {
        return $('id=com.androidsample.generalstore:id/nameField')
    }

    public get maleRadio() {
        return $('id=com.androidsample.generalstore:id/radioMale')
    }

    public get femaleRadio() {
        return $('id=com.androidsample.generalstore:id/radioFemale')
    }

    public get countryDropdown() {
        return $('id=com.androidsample.generalstore:id/spinnerCountry')
    }

    public get letsShopButton() {
        return $('id=com.androidsample.generalstore:id/btnLetsShop')
    }

    public get toolbarTitle() {
        return $('id=com.androidsample.generalstore:id/toolbar_title')
    }

    public async enterName(name: string) {
        await this.nameField.waitForDisplayed()
        await this.nameField.setValue(name)
    }

    public async selectGender(gender: Gender) {
        const radio = gender === 'male' ? this.maleRadio : this.femaleRadio
        await radio.waitForDisplayed()
        await radio.click()
    }

    public async openCountryDropdown() {
        await this.countryDropdown.waitForDisplayed()
        await this.countryDropdown.click()
    }

    public async selectCountry(country: string) {
        // Open dropdown first (safe to call even if already open)
        await this.openCountryDropdown()

        const scrollToCountry = $(
            `android=new UiScrollable(new UiSelector().scrollable(true)).scrollTextIntoView("${country}")`
        )
        await scrollToCountry.waitForExist({ timeout: 15000 })

        const countryOption = $(`android=new UiSelector().text("${country}")`)
        await countryOption.click()
    }

    public async tapLetsShop() {
        await this.letsShopButton.waitForDisplayed()
        await this.letsShopButton.click()
    }

    public async fillForm(params: { name: string; gender: Gender; country: string }) {
        await this.enterName(params.name)
        await this.selectGender(params.gender)
        await this.selectCountry(params.country)
        await this.tapLetsShop()
        return ProductsPage

    }
}

export default new HomePage()
