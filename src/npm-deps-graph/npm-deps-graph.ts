import "polymer/polymer.html";
import {customElement, property} from 'taktik-polymer-typescript';
import './npm-deps-graph.html'

/**
 * MyApp main class.
 */
@customElement('npm-deps-graph')
export class NpmDepsGraph extends Polymer.Element {


  /**
   * A property call myProperty
   * @type {string}
   */
@property({type: String})
  myProperty: string = 'an application scaffolds with love';
}

