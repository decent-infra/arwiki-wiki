import { Injectable } from '@angular/core';
import { 
	CanActivate, ActivatedRouteSnapshot, 
	CanActivateChild,
	RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable, of, interval } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { UserSettingsService } from '../core/user-settings.service';
import { UtilsService } from '../core/utils.service';
import { Router } from '@angular/router';
import { ArwikiLangIndex } from '../core/interfaces/arwiki-lang-index';
import { ArweaveService } from '../core/arweave.service';
import { ArwikiTokenContract } from '../core/arwiki-contracts/arwiki-token.service';
import { AuthService } from '../auth/auth.service';
import { ArwikiLangsService } from '../core/arwiki-contracts/arwiki-langs.service';
import { ArwikiAdminsService } from '../core/arwiki-contracts/arwiki-admins.service';
import { WarpContractsService } from '../core/warp-contracts.service';
import { ArweaveGateway } from '../core/interfaces/arweave-gateway';

@Injectable({
  providedIn: 'root'
})
export class InitPlatformGuard implements CanActivate, CanActivateChild {
	constructor(
		private _userSettings: UserSettingsService,
    private _utils: UtilsService,
    private _router: Router,
    private _arweave: ArweaveService,
    private _arwikiTokenContract: ArwikiTokenContract,
    private _auth: AuthService,
    private _arwikiTokenLangsContract: ArwikiLangsService,
    private _arwikiAdmins: ArwikiAdminsService,
    private _warp: WarpContractsService
	) {

	}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    // Init network settings
    this.initNetwork();

    // Validate language from route parameters
    const langPath = this.getLangFromRoute(route, state);
    return this.loadInitialValidations(langPath, route, state);
  }


  canActivateChild(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    // Init network settings
    this.initNetwork();

    // Validate language from route parameters
    const langPath = this.getLangFromRoute(route, state);
    return this.loadInitialValidations(langPath, route, state);
  }

  loadInitialValidations(lang: string, 
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> {
    let isValidLang = false;
    return (
      this.isValidLanguage(lang, route, state)
        .pipe(
          switchMap((_isValidLang: boolean) => {
            isValidLang = _isValidLang;
            // Loader
            this._userSettings.updateMainToolbarLoading(true);
            return this._arwikiTokenContract.getState();
          }),
          switchMap((_tokenContractState: any) => {
            // Loader
            console.log('Arwiki state loaded succesfully!');

            // Set token ticker
            const ticker = _tokenContractState.ticker ? 
              _tokenContractState.ticker : '';
            this._userSettings.setTokenTicker(ticker);
            
            this._userSettings.updateMainToolbarLoading(false);
            return of(isValidLang);
          }),
          switchMap((_isValidLang: boolean) => {
            return this.isUserModerator();
          }),
          switchMap((_isUserModerator: boolean) => {
            return of(isValidLang);
          }),
          catchError(err => {
            // Loader
            this._userSettings.updateMainToolbarLoading(false);
            this._utils.message(err, 'error');
            this._router.navigate(['error']);
            return of(false);
          })          
        )
    );
  }

  /*
  *  Detect if language code is present in url
  *  and validate against language contract
  */
  isValidLanguage(
    lang: string, 
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> {
    // Init loader
    this._userSettings.updateMainToolbarLoading(true);
    if (lang) {
      // If language detected
      return (
        // If no copy detected, get the state from the contract
        this._arwikiTokenLangsContract.getLanguages()
          .pipe(
            switchMap((state: ArwikiLangIndex) => {
              // Loader
              this._userSettings.updateMainToolbarLoading(false);
              // Show main toolbar 
              this._userSettings.updateMainToolbarVisiblity(true);
              // Scroll to top 
              this._userSettings.scrollToTop();

              // If success
              if (Object.prototype.hasOwnProperty.call(state, lang) &&
                state[lang].active) {
                this._userSettings.updateRouteLangObservable(lang);
                // Set default settings language 
                const currentDefaultLang = this._userSettings.getDefaultLang();
                if (!currentDefaultLang || currentDefaultLang.code != lang) {
                  this._userSettings.setDefaultLang(state[lang]);
                }

                return of(true);
              }
              // Else
              this._utils.message('Language not supported', 'error');

              this._router.navigate(['/']);

              return of(false);
            })
          )
      );
    }
    
    // No lang detected in route
    this._userSettings.updateRouteLangObservable('');
    // Loader
    this._userSettings.updateMainToolbarLoading(false);
    return of(true);
  }

  getLangFromRoute(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot) {
    let lang = '';
    if (route.params['lang']) {
      lang = route.params['lang'];
    }
    // Fix for nested routes
    else if (route.parent && route.parent.params['lang']) {
      lang = route.parent.params['lang'];
    }
    // Fix for wildcard route
    else if (route.url && route.url.length && route.url[0] &&
        route.url[0].path) {
      lang = route.url[0].path;
    }
    return lang;
  }

  isUserModerator() {
    const address = this._auth.getMainAddressSnapshot();
    this._userSettings.updateMainToolbarLoading(true);
    this._auth.updateUserIsModerator(false);
    return (this._arwikiAdmins.getAdminList()
      .pipe(
        switchMap((_adminList: string[]) => {
          const isAdmin = _adminList.indexOf(address) >= 0;

          this._userSettings.updateMainToolbarLoading(false);
          if (isAdmin) {
            this._auth.updateUserIsModerator(true);
            return of(true);
          }
          
          return of(false);
        }),
        catchError((error) => {
          this._utils.message(error, 'error');
          return of(false);
        }) 
      )
    );
  }

  initArweave(gatewayConfig: ArweaveGateway) {
    this._arweave.initArweave(gatewayConfig);    
  }

  initWarp(gatewayConfig: ArweaveGateway) {
    const useArweaveGW = gatewayConfig.useArweaveGW;
    const cacheOptions = undefined;
    if (gatewayConfig.host === 'localhost' ||
        gatewayConfig.host === '127.0.0.1') {
      this._warp.initLocalWarp(
        gatewayConfig.port,
        this._arweave,
        cacheOptions
      );
    } else {
      this._warp.initWarp(
        this._arweave,
        cacheOptions,
        useArweaveGW
      );
    }
    
  }

  initMainContract(gatewayConfig: ArweaveGateway) {
    const address = gatewayConfig.contractAddress;
    this._arwikiTokenContract.contractAddress = address;
  }

  initNetwork() {
    // Set default network
    const currentDefaultNetwork = this._userSettings.getDefaultNetwork();

    // Init Arweave
    this.initArweave(currentDefaultNetwork);

    // Init Warp
    this.initWarp(currentDefaultNetwork);

    // Init contract
    this.initMainContract(currentDefaultNetwork);
  }


  
}
