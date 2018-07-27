
import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './load-package.html';



@customElement('load-package')
export class DependencyLink extends Polymer.Element {
    @property({ type: String, notify: true, observer: 'packageNameChanged' })
    packageName: string;

    @property({ type: String, notify: true, observer: 'packageNameChanged' })
    packageVersion: string;

    @property({ type: String, notify: true })
    packageLockUrl: string;

    @property({ type: String })
    urlPrefix: string = "http://localhost:5000/package-lock";


    public packageNameChanged(c) {
        this.packageLockUrl = `${this.urlPrefix}/${this.packageName}/${this.packageVersion}`
    }
}
