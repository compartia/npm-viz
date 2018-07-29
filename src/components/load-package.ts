
import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './load-package.html';
import { REGISTRY_URL } from "../consts";


@customElement('load-package')
export class DependencyLink extends Polymer.Element {
    @property({ type: String, notify: true, observer: 'packageNameChanged' })
    packageName: string;

    @property({ type: String, notify: true, observer: 'packageNameChanged' })
    packageVersion: string;

    @property({ type: String, notify: true })
    packageLockUrl: string;

    @property({ type: String })
    urlPrefix: string = REGISTRY_URL + "/package-lock";

    private _ignoreUpdates = false;

    public urlChanged(c) {

    }

    public packageNameChanged(c) {
        if (this._ignoreUpdates) return;
        this.packageLockUrl = `${this.urlPrefix}/${this.packageName}/${this.packageVersion}`
    }

    public loadGraph(): void {
        let detail = {
            name: this.packageName,
            version: this.packageVersion,
            url: this.packageLockUrl
        };
        console.error("firing");
        this.dispatchEvent(new CustomEvent("load-graph", { bubbles: true, detail: detail }));
    }
}
