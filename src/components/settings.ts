
import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './settings.html';



@customElement('view-settings')
export class DependencyLink extends Polymer.Element {
    @property({ type: String, notify: true })
    selectedColorBy: any = "CARDINALITY";

    @property({ type: Array })
    colorByTypes: any = ["CARDINALITY", "DEVICE"];

}
