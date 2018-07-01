import "polymer/polymer.html";
import { customElement, property } from 'taktik-polymer-typescript';
import './tf-graph.html'
import './tf-graph-scene'



@customElement('tf-graph')
export class TfGraphElement extends Polymer.Element {


  /**
   * A property call myProperty
   * @type {string}
   */
  @property({ type: String })
  myProperty: string = 'an application scaffolds with love';
}

