<?php

namespace Dakin\Amalgam;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Blade;

class AmalgamServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void {}

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // SUBSTITUTING SCRIPT:SETUP
        Blade::prepareStringsForCompilationUsing(function ($value) {
            $path = app('blade.compiler')->getPath();

            return preg_replace_callback(
                '/<script\s[^>]*\beditor\b[^>]*>.*?<\/script>/s',
                function () use ($path) {
                    return "";
                    // $componentName = str($path)
                    //     ->after(resource_path('views/'))
                    //     ->before('.blade.php')
                    //     ->replace('/', '.');

                    // return <<<BLADE
                    //     BLADE;
                },
                $value
            );
        });
    }
}
